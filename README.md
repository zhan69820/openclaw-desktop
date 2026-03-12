# OpenClaw 桌面版

便携式 OpenClaw 桌面客户端，零依赖，开箱即用。

## ✨ 功能特性

- **零系统依赖**：完全独立于系统环境运行，无需预装 Node.js
- **自动环境配置**：自动下载并配置所需运行环境
- **便携式安装**：所有数据存储在用户数据目录，随时随地使用
- **集成 Web 界面**：内置浏览器直接访问 OpenClaw 控制面板
- **明暗主题切换**：支持明亮/暗黑模式，默认明亮模式
- **跨平台支持**：支持 Windows、macOS 和 Linux

## 🚀 快速开始

### 一键安装运行

```bash
# 克隆仓库并运行安装脚本
git clone https://github.com/zhan69820/openclaw-desktop.git
cd openclaw-desktop
./setup.sh
```

### 手动安装

```bash
# 克隆仓库
git clone https://github.com/zhan69820/openclaw-desktop.git
cd openclaw-desktop

# 安装依赖
npm install

# 启动应用
npm start
```

## 📖 使用说明

### 首次使用

1. **欢迎页面**：打开软件后，您将看到欢迎页面，了解软件的主要功能
2. **开始安装**：点击"开始安装"按钮，软件将自动配置运行环境
3. **等待安装**：安装过程包括：
   - 下载并配置私有 Node.js 环境
   - 安装 OpenClaw 核心组件
   - 完成环境初始化
4. **进入应用**：安装完成后，点击"进入应用"按钮
5. **启动服务**：在控制面板中点击"启动服务"开始使用

### 主题切换

- 点击右上角的太阳/月亮图标可在明亮模式和暗黑模式之间切换
- 主题偏好会自动保存，下次启动时保持您的选择

### 日常使用

- **启动服务**：点击"启动服务"按钮启动 OpenClaw
- **停止服务**：点击"停止服务"按钮关闭 OpenClaw
- **重新安装**：如需重新配置环境，点击"重新安装"按钮

## 🏗️ 架构设计

本应用采用便携式沙箱架构，不依赖任何系统环境变量或预装组件。所有操作都在 Electron 的私有用户数据目录中完成。

### 目录结构

```
[userData 目录]
├── /env
│   └── /node       <-- 下载的免安装版 Node.js
├── /app
│   └── /openclaw   <-- OpenClaw 私有运行目录
│       ├── package.json
│       └── /node_modules
└── /logs           <-- 运行与报错日志
```

## 🔧 核心流程

### 阶段一：自动部署私有 Node.js

1. **环境检测**：检查 `userData/env/node/bin/node`（macOS/Linux）或 `node.exe`（Windows）是否存在
2. **静默下载**：根据系统架构（x64/arm64），从 Node.js 官方下载编译好的二进制压缩包
3. **本地解压**：使用 `extract-zip`（Windows）或 `tar`（macOS/Linux）解压到 `/env/node` 目录

### 阶段二：私有化安装

**重要**：绝不使用全局命令，必须通过 Node.js 的 `child_process.spawn` 调用私有环境执行安装。

关键步骤：
- 在 `/app/openclaw` 目录下动态生成内容为 `{}` 的 `package.json`
- 执行 `spawn` 时传入自定义的 `env` 对象，将私有 Node.js 的 bin 目录路径拼接到系统 PATH 变量最前方
- 调用私有的 npm 执行 `npm install openclaw`
- 通过 `spawn.stdout.on('data')` 实时转发日志到前端界面

### 阶段三：运行机制

#### 启动服务
- 继续使用环境变量劫持技术，通过 `spawn` 调用 `userData/app/openclaw/node_modules/.bin/openclaw`
- 将子进程对象保存为全局变量
- 监听 Electron 主窗口的 `close` 事件，在软件关闭时触发 `child.kill()` 彻底杀掉 OpenClaw 进程

#### 服务状态检测
- 监听 OpenClaw 进程的控制台输出（stdout）
- 使用正则表达式匹配服务启动信息（如 "Dashboard URL: http://127.0.0.1:XXXX"）
- 一旦匹配成功，通过 IPC 通知前端服务已就绪

#### Web 界面集成
- 使用 `<webview>` 标签将 OpenClaw 的 Web 界面嵌入到应用中
- 用户无需知道 localhost，获得原生应用体验

## 💻 开发指南

### 环境要求

- Node.js 16+（仅开发需要，用户无需安装）
- npm 或 yarn

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式启动
npm run dev

# 构建应用
npm run build

# 打包（不构建安装包）
npm run pack
```

### 项目结构

```
openclaw-desktop/
├── main.js          # 主进程 - 环境管理和 OpenClaw 控制
├── index.html       # 前端界面 - 欢迎页、安装进度、控制面板
├── package.json     # 项目配置和依赖
├── setup.sh         # 一键安装脚本
├── .gitignore       # Git 忽略配置
└── README.md        # 项目文档
```

## 🛠️ 技术细节

### 环境变量劫持

```javascript
// 核心逻辑：确保无论在哪都强制使用私有 Node
const path = require('path');
const { spawn } = require('child_process');

// 1. 获取私有 Node.js 的执行路径
const privateNodeBinPath = path.join(app.getPath('userData'), 'env', 'node', 'bin');

// 2. 克隆当前系统环境变量，并将私有路径插到最前面
const customEnv = Object.assign({}, process.env);
customEnv.PATH = `"${privateNodeBinPath}"${path.delimiter}${customEnv.PATH}`;

// 3. 启动私有安装或运行进程
const child = spawn('npm', ['install', 'openclaw'], {
    cwd: path.join(app.getPath('userData'), 'app', 'openclaw'),
    env: customEnv, // 使用劫持后的环境变量
    shell: true     // 跨平台兼容需要
});

child.stdout.on('data', (data) => {
    // 将 data.toString() 实时发送给前端 UI 显示
});
```

## 📦 构建发布

### macOS
```bash
npm run build -- --mac
```

### Windows
```bash
npm run build -- --win
```

### Linux
```bash
npm run build -- --linux
```

构建完成后，安装包将位于 `dist/` 目录。

## 🤝 贡献指南

1. Fork 本仓库
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 Pull Request

## 📝 开源协议

本项目基于 MIT 协议开源 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - 强大的 AI 助手平台
- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [Node.js](https://nodejs.org/) - JavaScript 运行时

## 📮 联系我们

如有问题或建议，欢迎通过以下方式联系：

- 提交 [Issue](https://github.com/zhan69820/openclaw-desktop/issues)
- 发送邮件至项目维护者

---

**注意**：本项目仅供学习和研究使用，请遵守相关法律法规。