#!/bin/bash

# Exit on any failure
set -e

# Resolve the project root directory relative to the script location
cd "$(dirname "$0")/.."
echo "📂 Project root set to: $(pwd)"

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

# 3. Package extension into .vsix file inside the release/ directory
echo "📦 Compiling .vsix package..."
mkdir -p release
npx -y @vscode/vsce package --allow-missing-repository -o release/vscodebrowser-0.1.0.vsix

echo "✅ VSCode Browser extension packaged successfully at: release/vscodebrowser-0.1.0.vsix"

