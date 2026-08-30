#!/usr/bin/env bash

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "==================================================="
echo " Starting CinePulse Server (macOS / Linux)..."
echo "==================================================="

# Check for system Node.js
if command -v node &> /dev/null; then
    echo "[INFO] System Node.js detected: $(node -v)"
    NODE_BIN="node"
    NPM_BIN="npm"
else
    echo "[INFO] Node.js not detected. Setting up portable Node.js runtime..."
    
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    NODE_VERSION="v20.18.0"
    
    mkdir -p "$DIR/.node"
    
    if [ "$OS" = "Darwin" ]; then
        if [ "$ARCH" = "arm64" ]; then
            TARGET="node-${NODE_VERSION}-darwin-arm64"
        else
            TARGET="node-${NODE_VERSION}-darwin-x64"
        fi
        URL="https://nodejs.org/dist/${NODE_VERSION}/${TARGET}.tar.gz"
    else
        TARGET="node-${NODE_VERSION}-linux-x64"
        URL="https://nodejs.org/dist/${NODE_VERSION}/${TARGET}.tar.xz"
    fi
    
    if [ ! -f "$DIR/.node/${TARGET}/bin/node" ]; then
        echo "[INFO] Downloading portable Node.js runtime from ${URL}..."
        curl -sSL "$URL" -o "$DIR/.node/node_archive"
        
        echo "[INFO] Extracting Node.js runtime..."
        if [[ "$URL" == *.tar.xz ]]; then
            tar -xf "$DIR/.node/node_archive" -C "$DIR/.node/"
        else
            tar -xzf "$DIR/.node/node_archive" -C "$DIR/.node/"
        fi
        rm -f "$DIR/.node/node_archive"
    fi
    
    export PATH="$DIR/.node/${TARGET}/bin:$PATH"
    NODE_BIN="$DIR/.node/${TARGET}/bin/node"
    NPM_BIN="$DIR/.node/${TARGET}/bin/npm"
    echo "[INFO] Portable Node.js initialized: $($NODE_BIN -v)"
fi

if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing required dependencies..."
    $NPM_BIN install
fi

echo "[INFO] Opening Chrome / Default Browser at http://localhost:3000..."
if command -v open &> /dev/null; then
    open http://localhost:3000
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
fi

echo "[INFO] Launching server engine with auto-recovery..."
until $NODE_BIN server.js; do
    echo "[WARNING] Server engine stopped. Auto-restarting in 2 seconds..."
    sleep 2
done
