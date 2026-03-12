const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const extract = require('extract-zip');

// 全局变量
let openclawProcess = null;
let mainWindow = null;

// 路径配置
const userDataPath = app.getPath('userData');
const envPath = path.join(userDataPath, 'env');
const nodePath = path.join(envPath, 'node');
const appPath = path.join(userDataPath, 'app');
const openclawPath = path.join(appPath, 'openclaw');
const logsPath = path.join(userDataPath, 'logs');

// 检测是否已安装 OpenClaw
function isOpenClawInstalled() {
    const openclawModulePath = path.join(openclawPath, 'node_modules', 'openclaw');
    const packageJsonPath = path.join(openclawPath, 'package.json');
    return fs.existsSync(openclawModulePath) && fs.existsSync(packageJsonPath);
}

// 检测是否已安装私有 Node.js
function isPrivateNodeInstalled() {
    const { osType } = getSystemInfo();
    const nodeExecutable = osType === 'win' ? 
        path.join(nodePath, 'node.exe') : 
        path.join(nodePath, 'bin', 'node');
    return fs.existsSync(nodeExecutable);
}

// 创建目录
function createDirectories() {
    [envPath, nodePath, appPath, openclawPath, logsPath].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// 获取系统信息
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
            throw new Error(`不支持的操作系统: ${platform}`);
    }
    
    return { osType, osArch };
}

// 获取 Node.js 下载 URL
function getNodeDownloadUrl(osType, osArch) {
    const version = '20.11.0';
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

// 安装私有 Node.js
async function installPrivateNodeJS() {
    const { osType, osArch } = getSystemInfo();
    
    console.log(`正在安装 Node.js (${osType}-${osArch})...`);
    
    try {
        const downloadUrl = getNodeDownloadUrl(osType, osArch);
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
        
        // 解压
        if (osType === 'win') {
            await extract(tempFile, { dir: nodePath });
        } else {
            const tar = require('tar');
            await tar.extract({ file: tempFile, cwd: envPath });
            
            const extractedDir = path.join(envPath, fs.readdirSync(envPath).find(f => f.startsWith('node-v')));
            if (extractedDir && fs.existsSync(extractedDir)) {
                const files = fs.readdirSync(extractedDir);
                files.forEach(file => {
                    fs.renameSync(path.join(extractedDir, file), path.join(nodePath, file));
                });
                fs.rmdirSync(extractedDir);
            }
        }
        
        fs.unlinkSync(tempFile);
        console.log('Node.js 安装完成');
        return true;
    } catch (error) {
        console.error('Node.js 安装失败:', error);
        throw error;
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
    
    const customEnv = Object.assign({}, process.env);
    customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
    
    console.log('正在安装 OpenClaw...');
    
    return new Promise((resolve, reject) => {
        const installProcess = spawn(`"${npmPath}"`, ['install', 'openclaw'], {
            cwd: openclawPath,
            env: customEnv,
            shell: true
        });
        
        installProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('[安装]', output);
            if (mainWindow) {
                mainWindow.webContents.send('install-log', output);
            }
        });
        
        installProcess.stderr.on('data', (data) => {
            const error = data.toString();
            console.error('[安装错误]', error);
            if (mainWindow) {
                mainWindow.webContents.send('install-error', error);
            }
        });
        
        installProcess.on('close', (code) => {
            if (code === 0) {
                console.log('OpenClaw 安装完成');
                resolve(true);
            } else {
                reject(new Error(`安装失败，退出码 ${code}`));
            }
        });
        
        installProcess.on('error', reject);
    });
}

// 读取 OpenClaw token
function getOpenClawToken() {
    try {
        const configPath = path.join(require('os').homedir(), '.openclaw-dev', 'openclaw.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config.gateway?.auth?.token || null;
        }
    } catch (error) {
        console.error('读取 token 失败:', error);
    }
    return null;
}

// 启动 OpenClaw
function startOpenClaw() {
    const { osType } = getSystemInfo();
    const nodeBinPath = osType === 'win' ? nodePath : path.join(nodePath, 'bin');
    const openclawBin = osType === 'win' ?
        path.join(openclawPath, 'node_modules', '.bin', 'openclaw.cmd') :
        path.join(openclawPath, 'node_modules', '.bin', 'openclaw');
    
    const customEnv = Object.assign({}, process.env);
    customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
    
    console.log('正在启动 OpenClaw Gateway...');
    
    // 用 gateway 命令启动常驻服务（dashboard 是一次性命令，会立即退出）
    openclawProcess = spawn(`"${openclawBin}"`, ['--dev', 'gateway'], {
        cwd: openclawPath,
        env: customEnv,
        shell: true
    });
    
    let serverNotified = false;
    
    openclawProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[OpenClaw]', output);
        
        // 检测 gateway 监听就绪
        const gatewayMatch = output.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/i);
        
        if (gatewayMatch && !serverNotified) {
            serverNotified = true;
            const port = gatewayMatch[1];
            const token = getOpenClawToken();
            console.log(`Gateway 就绪，端口: ${port}, token: ${token ? '已获取' : '未获取'}`);
            
            // 延迟 2 秒后打开浏览器
            setTimeout(() => {
                const url = token ? 
                    `http://127.0.0.1:${port}/#token=${token}` : 
                    `http://127.0.0.1:${port}/`;
                console.log('正在打开浏览器:', url);
                shell.openExternal(url);
                
                if (mainWindow) {
                    mainWindow.webContents.send('server-ready', { port });
                }
            }, 2000);
        }
        
        if (mainWindow) {
            mainWindow.webContents.send('server-log', output);
        }
    });
    
    openclawProcess.stderr.on('data', (data) => {
        const error = data.toString();
        console.error('[OpenClaw 错误]', error);
        if (mainWindow) {
            mainWindow.webContents.send('server-error', error);
        }
    });
    
    openclawProcess.on('close', (code) => {
        console.log('OpenClaw 已停止, 退出码:', code);
        openclawProcess = null;
        serverNotified = false;
        if (mainWindow) {
            mainWindow.webContents.send('server-stopped');
        }
    });
}

// 停止 OpenClaw
function stopOpenClaw() {
    if (openclawProcess) {
        openclawProcess.kill();
        openclawProcess = null;
    }
}

// 创建窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            webSecurity: false,
            allowRunningInsecureContent: true
        },
        titleBarStyle: 'hiddenInset',
        show: false,
        backgroundColor: '#f8fafc'
    });
    
    mainWindow.loadFile('index.html');
    
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // 检查安装状态并通知前端
        const nodeInstalled = isPrivateNodeInstalled();
        const openclawInstalled = isOpenClawInstalled();
        
        console.log('安装状态:', { nodeInstalled, openclawInstalled });
        
        mainWindow.webContents.send('check-status', {
            nodeInstalled,
            openclawInstalled,
            fullyInstalled: nodeInstalled && openclawInstalled
        });
    });
    
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 应用生命周期
app.whenReady().then(() => {
    createWindow();
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
ipcMain.handle('install-environment', async () => {
    try {
        createDirectories();
        
        // 安装 Node.js
        if (!isPrivateNodeInstalled()) {
            mainWindow.webContents.send('install-status', { step: 'nodejs', status: 'installing' });
            await installPrivateNodeJS();
            mainWindow.webContents.send('install-status', { step: 'nodejs', status: 'completed' });
        }
        
        // 安装 OpenClaw
        if (!isOpenClawInstalled()) {
            mainWindow.webContents.send('install-status', { step: 'openclaw', status: 'installing' });
            await installOpenClaw();
            mainWindow.webContents.send('install-status', { step: 'openclaw', status: 'completed' });
        }
        
        return { success: true };
    } catch (error) {
        console.error('安装失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-server', async () => {
    try {
        if (!isOpenClawInstalled()) {
            return { success: false, error: 'OpenClaw 未安装，请先安装环境' };
        }
        
        // 防止重复启动
        if (openclawProcess) {
            return { success: false, error: 'OpenClaw 已在运行中' };
        }
        
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
        nodeInstalled: isPrivateNodeInstalled(),
        openclawInstalled: isOpenClawInstalled(),
        userDataPath: userDataPath
    };
});

// 配置模型
ipcMain.handle('config-model', async (event, { provider, apiKey, model }) => {
    try {
        const { osType } = getSystemInfo();
        const nodeBinPath = osType === 'win' ? nodePath : path.join(nodePath, 'bin');
        const openclawBin = osType === 'win' ?
            path.join(openclawPath, 'node_modules', '.bin', 'openclaw.cmd') :
            path.join(openclawPath, 'node_modules', '.bin', 'openclaw');
        
        const customEnv = Object.assign({}, process.env);
        customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
        
        // 设置模型
        await new Promise((resolve, reject) => {
            const proc = spawn(`"${openclawBin}"`, ['--dev', 'config', 'set', 'agent.model', model], {
                cwd: openclawPath,
                env: customEnv,
                shell: true
            });
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('设置模型失败')));
        });
        
        // 设置 API Key
        await new Promise((resolve, reject) => {
            const proc = spawn(`"${openclawBin}"`, ['--dev', 'models', 'auth', 'paste-token'], {
                cwd: openclawPath,
                env: { ...customEnv, OPENCLAW_TOKEN: apiKey },
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            proc.stdin.write(apiKey + '\n');
            proc.stdin.end();
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('设置 API Key 失败')));
        });
        
        return { success: true };
    } catch (error) {
        console.error('配置模型失败:', error);
        return { success: false, error: error.message };
    }
});

// 配置渠道
ipcMain.handle('config-channel', async (event, { channel, token }) => {
    try {
        const { osType } = getSystemInfo();
        const nodeBinPath = osType === 'win' ? nodePath : path.join(nodePath, 'bin');
        const openclawBin = osType === 'win' ?
            path.join(openclawPath, 'node_modules', '.bin', 'openclaw.cmd') :
            path.join(openclawPath, 'node_modules', '.bin', 'openclaw');
        
        const customEnv = Object.assign({}, process.env);
        customEnv.PATH = `"${nodeBinPath}"${path.delimiter}${customEnv.PATH}`;
        
        await new Promise((resolve, reject) => {
            const proc = spawn(`"${openclawBin}"`, ['--dev', 'channels', 'add', '--channel', channel, '--token', token], {
                cwd: openclawPath,
                env: customEnv,
                shell: true
            });
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('配置渠道失败')));
        });
        
        return { success: true };
    } catch (error) {
        console.error('配置渠道失败:', error);
        return { success: false, error: error.message };
    }
});

// 重置配置
ipcMain.handle('reset-config', async () => {
    try {
        const configDir = path.join(require('os').homedir(), '.openclaw-dev');
        if (fs.existsSync(configDir)) {
            fs.rmSync(configDir, { recursive: true });
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 卸载
ipcMain.handle('uninstall', async () => {
    try {
        stopOpenClaw();
        
        // 删除配置目录
        const configDir = path.join(require('os').homedir(), '.openclaw-dev');
        if (fs.existsSync(configDir)) {
            fs.rmSync(configDir, { recursive: true });
        }
        
        // 删除安装目录
        if (fs.existsSync(openclawPath)) {
            fs.rmSync(openclawPath, { recursive: true });
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});