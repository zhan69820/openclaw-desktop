const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const extract = require('extract-zip');

// 全局变量存储 OpenClaw 进程
let openclawProcess = null;
let mainWindow = null;

// 获取用户数据目录
const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, 'env');
const nodePath = path.join(envPath, 'node');
const appPath = path.join(userDataPath, 'app');
const openclawPath = path.join(appPath, 'openclaw');
const logsPath = path.join(userDataPath, 'logs');

console.log('User Data Path:', userDataPath);

// 创建目录结构
function createDirectories() {
    const dirs = [envPath, nodePath, appPath, openclawPath, logsPath];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    });
}

// 检测操作系统和架构
function getSystemInfo() {
    const platform = process.platform;
    const arch = process.arch;
    
    let osType, osArch;
    
    switch (platform) {
        case 'darwin':
            osType = 'darwin';
            osArch = arch === 'arm64' ? 'arm64' : 'x64';
            break;
        case 'win32':
            osType = 'win';
            osArch = arch === 'arm64' ? 'arm64' : 'x64';
            break;
        case 'linux':
            osType = 'linux';
            osArch = arch === 'arm64' ? 'arm64' : 'x64';
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return { osType, osArch };
}

// 获取 Node.js 下载 URL
function getNodeDownloadUrl(osType, osArch) {
    const version = '20.11.0'; // 使用 LTS 版本
    let filename;
    
    switch (osType) {
        case 'darwin':
            filename = `node-v${version}-darwin-${osArch}.tar.gz`;
            break;
        case 'win':
            filename = `node-v${version}-win-${osArch}.zip`;
            break;
        case 'linux':
            filename = `node-v${version}-linux-${osArch}.tar.xz`;
            break;
    }
    
    return `https://nodejs.org/dist/v${version}/${filename}`;
}

// 下载并解压 Node.js
async function setupPrivateNodeJS() {
    const { osType, osArch } = getSystemInfo();
    const nodeExecutable = osType === 'win' ? 
        path.join(nodePath, 'node.exe') : 
        path.join(nodePath, 'bin', 'node');
    
    // 检查是否已存在
    if (fs.existsSync(nodeExecutable)) {
        console.log('Private Node.js already exists');
        return true;
    }
    
    console.log(`Setting up private Node.js for ${osType}-${osArch}`);
    
    try {
        // 下载 Node.js
        const downloadUrl = getNodeDownloadUrl(osType, osArch);
        console.log(`Downloading from: ${downloadUrl}`);
        
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream'
        });
        
        const tempFile = path.join(envPath, `node-temp.${osType === 'win' ? 'zip' : 'tar.gz'}`);
        
        const writer = fs.createWriteStream(tempFile);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        console.log('Download completed, extracting...');
        
        // 解压文件
        if (osType === 'win') {
            await extract(tempFile, { dir: nodePath });
        } else {
            const tar = require('tar');
            await tar.extract({
                file: tempFile,
                cwd: envPath
            });
            
            // 移动解压后的文件到正确位置
            const extractedDir = path.join(envPath, fs.readdirSync(envPath).find(f => f.startsWith('node-v')));
            if (extractedDir && fs.existsSync(extractedDir)) {
                const files = fs.readdirSync(extractedDir);
                files.forEach(file => {
                    const src = path.join(extractedDir, file);
                    const dest = path.join(nodePath, file);
                    fs.renameSync(src, dest);
                });
                fs.rmdirSync(extractedDir);
            }
        }
        
        // 清理临时文件
        fs.unlinkSync(tempFile);
        
        console.log('Private Node.js setup completed');
        return true;
    } catch (error) {
        console.error('Failed to setup private Node.js:', error);
        return false;
    }
}

// 安装 OpenClaw
async function installOpenClaw() {
    const { osType } = getSystemInfo();
    const nodeBinPath = osType === 'win' ? nodePath : path.join(nodePath, 'bin');
    const npmPath = osType === 'win' ? 
        path.join(nodePath, 'npm.cmd') : 
        path.join(nodePath, 'bin', 'npm');
    
    // 创建 package.json
    const packageJsonPath = path.join(openclawPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(packageJsonPath, JSON.stringify({}, null, 2));
    }
    
    // 设置环境变量
    const customEnv = Object.assign({}, process.env);
    customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
    
    console.log('Installing OpenClaw...');
    
    // 确保路径被正确引用
    console.log('NPM Path:', npmPath);
    console.log('Working Directory:', openclawPath);
    console.log('Custom PATH:', customEnv.PATH);
    
    return new Promise((resolve, reject) => {
        const installProcess = spawn(`"${npmPath}"`, ['install', 'openclaw'], {
            cwd: openclawPath,
            env: customEnv,
            shell: true
        });
        
        installProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('[NPM INSTALL]', output);
            if (mainWindow) {
                mainWindow.webContents.send('install-progress', output);
            }
        });
        
        installProcess.stderr.on('data', (data) => {
            const error = data.toString();
            console.error('[NPM INSTALL ERROR]', error);
            if (mainWindow) {
                mainWindow.webContents.send('install-error', error);
            }
        });
        
        installProcess.on('close', (code) => {
            if (code === 0) {
                console.log('OpenClaw installation completed');
                resolve(true);
            } else {
                console.error('OpenClaw installation failed with code:', code);
                reject(new Error(`Installation failed with code ${code}`));
            }
        });
        
        installProcess.on('error', (error) => {
            console.error('Failed to start npm install:', error);
            reject(error);
        });
    });
}

// 启动 OpenClaw
function startOpenClaw() {
    const { osType } = getSystemInfo();
    const nodeBinPath = osType === 'win' ? nodePath : path.join(nodePath, 'bin');
    const openclawBin = osType === 'win' ?
        path.join(openclawPath, 'node_modules', '.bin', 'openclaw.cmd') :
        path.join(openclawPath, 'node_modules', '.bin', 'openclaw');
    
    // 设置环境变量
    const customEnv = Object.assign({}, process.env);
    customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
    
    console.log('Starting OpenClaw...');
    
    // 记录调试信息
    console.log('OpenClaw Binary Path:', openclawBin);
    console.log('Working Directory:', openclawPath);
    console.log('Custom PATH:', customEnv.PATH);
    
    openclawProcess = spawn(`"${openclawBin}"`, ['dashboard'], {
        cwd: openclawPath,
        env: customEnv,
        shell: true
    });
    
    openclawProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[OPENCLAW]', output);
        
        // 监听端口信息
        const portMatch = output.match(/Dashboard URL: http:\/\/127\.0\.0\.1:(\d+)\//i) ||
                         output.match(/(?:Server is running on port|localhost:)(\d+)/i);
        if (portMatch) {
            const port = portMatch[1];
            console.log(`OpenClaw server detected on port ${port}`);
            if (mainWindow) {
                mainWindow.webContents.send('server-ready', { port });
            }
        }
        
        if (mainWindow) {
            mainWindow.webContents.send('openclaw-output', output);
        }
    });
    
    openclawProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.error('[OPENCLAW ERROR]', error);
        if (mainWindow) {
            mainWindow.webContents.send('openclaw-error', error);
        }
    });
    
    openclawProcess.on('close', (code) => {
        console.log('OpenClaw process closed with code:', code);
        openclawProcess = null;
        if (mainWindow) {
            mainWindow.webContents.send('server-stopped');
        }
    });
    
    openclawProcess.on('error', (error) => {
        console.error('Failed to start OpenClaw:', error);
        if (mainWindow) {
            mainWindow.webContents.send('server-error', error.message);
        }
    });
}

// 停止 OpenClaw
function stopOpenClaw() {
    if (openclawProcess) {
        console.log('Stopping OpenClaw process...');
        openclawProcess.kill();
        openclawProcess = null;
    }
}

// 创建主窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    mainWindow.loadFile('index.html');
    
    // 开发模式下打开开发者工具
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 应用生命周期
app.whenReady().then(async () => {
    createDirectories();
    
    createWindow();
    
    // 自动设置环境并安装
    try {
        mainWindow.webContents.send('setup-started');
        
        const nodeSetupSuccess = await setupPrivateNodeJS();
        if (!nodeSetupSuccess) {
            throw new Error('Failed to setup private Node.js');
        }
        
        mainWindow.webContents.send('node-setup-complete');
        
        await installOpenClaw();
        mainWindow.webContents.send('install-complete');
        
    } catch (error) {
        console.error('Setup failed:', error);
        if (mainWindow) {
            mainWindow.webContents.send('setup-error', error.message);
        }
    }
});

app.on('window-all-closed', () => {
    stopOpenClaw();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', () => {
    stopOpenClaw();
});

// IPC 处理
ipcMain.handle('start-server', async () => {
    try {
        startOpenClaw();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-server', async () => {
    try {
        stopOpenClaw();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-status', async () => {
    return {
        serverRunning: openclawProcess !== null,
        userDataPath: userDataPath
    };
});