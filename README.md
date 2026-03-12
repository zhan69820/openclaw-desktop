# OpenClaw Desktop

Portable OpenClaw desktop client with zero-dependency sandbox environment.

## Features

- **Zero System Dependencies**: Runs completely isolated from your system environment
- **Automatic Setup**: Downloads and configures Node.js automatically
- **Portable Installation**: All data stored in user data directory
- **Integrated Web UI**: Built-in browser to access OpenClaw web interface
- **Cross-platform**: Works on Windows, macOS, and Linux

## Architecture Overview

This application uses a portable sandbox approach that doesn't rely on any system environment variables or pre-installed components. All operations are contained within Electron's private user data directory.

### Directory Structure

```
[userData Directory]
├── /env
│   └── /node       <-- Downloaded and extracted Node.js binaries
├── /app
│   └── /openclaw   <-- OpenClaw private runtime directory
│       ├── package.json (auto-generated empty file)
│       └── /node_modules
└── /logs           <-- Runtime and error logs
```

## Development Setup

### Prerequisites

- Node.js (for development only - not required for end users)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd openclaw-desktop

# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build
```

## How It Works

### Phase 1: Automatic Private Node.js Deployment

1. **Environment Probe**: Checks if private Node.js exists at `userData/env/node/bin/node` (macOS/Linux) or `node.exe` (Windows)
2. **Silent Download**: Downloads pre-compiled binaries from Node.js official site based on user's system architecture (x64/arm64)
3. **Local Extraction**: Extracts using `extract-zip` (Windows) or `tar` (macOS/Linux) to `/env/node` directory

### Phase 2: Private Installation (Critical)

**Important**: Never use global commands. Always use `child_process.spawn` to call the private environment.

Key requirements:
- Generate empty `{}` package.json in `/app/openclaw` directory
- Hijack environment variables by prepending private Node.js bin path to system PATH
- Execute private npm (`userData/env/node/bin/npm`) to run `npm install openclaw`
- Stream logs via `spawn.stdout.on('data')` to frontend terminal display

### Phase 3: Runtime Mechanism

#### Step 1: Background Daemon Startup
When user clicks "Start":
- Use environment hijacking to call `userData/app/openclaw/node_modules/.bin/openclaw`
- Store child process object as global variable
- Listen for Electron main window close event to kill OpenClaw process

#### Step 2: Service Readiness Detection
- Monitor OpenClaw process console output (stdout)
- Use regex to match service startup messages (e.g., "Server is running on port XXXX")
- Send IPC message to frontend with detected port number

#### Step 3: Web UI Integration
Two presentation options:
- **Option A (Recommended)**: Use `<webview>` or `<iframe>` to embed `http://localhost:XXXX` seamlessly
- **Option B**: Create new BrowserWindow with hidden menu/address bar

## Core Technical Concepts

### Environment Variable Hijacking

```javascript
// Core logic: Force private Node.js usage regardless of host environment
const path = require('path');
const { spawn } = require('child_process');

// 1. Get private Node.js executable path
const privateNodeBinPath = path.join(app.getPath('userData'), 'env', 'node', 'bin');

// 2. Clone system environment and prepend private path (crucial)
const customEnv = Object.assign({}, process.env);
customEnv.PATH = `${privateNodeBinPath}${path.delimiter}${customEnv.PATH}`;

// 3. Launch private installation or runtime process
const child = spawn('npm', ['install', 'openclaw'], {
    cwd: path.join(app.getPath('userData'), 'app', 'openclaw'),
    env: customEnv, // Use hijacked environment variables
    shell: true     // Cross-platform compatibility
});

child.stdout.on('data', (data) => {
    // Forward data.toString() to frontend UI display
});
```

## Building Releases

### For macOS
```bash
npm run build -- --mac
```

### For Windows
```bash
npm run build -- --win
```

### For Linux
```bash
npm run build -- --linux
```

## Project Structure

```
openclaw-desktop/
├── main.js          # Main Electron process
├── index.html       # Frontend UI
├── package.json     # Project configuration
├── README.md        # This file
└── dist/           # Build output (generated)
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request