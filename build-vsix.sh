#!/bin/bash

# Exit on any failure
set -e

echo "📦 Starting VSCode Browser packaging process..."

# Add local Node.js sandboxed environment to PATH if present
LOCAL_NODE_PATH="/home/user/.local/node-env/bin"
if [ -d "$LOCAL_NODE_PATH" ]; then
    export PATH="$LOCAL_NODE_PATH:$PATH"
    echo "⚡ Local Node.js environment detected and added to PATH."
fi

# Verify active tool versions
echo "Using Node version: $(node -v)"
echo "Using NPM version: $(npm -v)"

# 1. Install dependencies
echo "⚙️  Installing node modules..."
npm install

# 2. Compile bundle with production optimizations
echo "⚡ Compiling production bundle..."
npm run package

# 3. Package extension into .vsix file using vsce
echo "📦 Compiling .vsix package..."
npx -y @vscode/vsce package --allow-missing-repository

echo "✅ VSCode Browser extension packaged successfully!"
