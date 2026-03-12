#!/bin/bash

# OpenClaw 桌面版安装脚本

echo "🚀 正在设置 OpenClaw 桌面版..."
echo ""

# 检查 Node.js 是否已安装
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js 版本: $(node --version)"
echo ""

# 安装依赖
echo "📦 正在安装依赖..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ 依赖安装成功！"
    echo ""
else
    echo "❌ 依赖安装失败"
    exit 1
fi

# 启动应用
echo "🎮 正在启动 OpenClaw 桌面版..."
echo "   首次启动需要下载环境，请耐心等待..."
echo ""
npm start