# CinePulse - Standalone Zero-Setup Web App

A self-contained, cross-platform media streaming application powered by **Node.js, Express, WebTorrent, and HTML5 video**.

> **⚡ Zero-Setup Design**: You do NOT need to manually install Node.js! The launcher scripts will automatically detect, download, and configure a portable Node.js runtime if one is missing on your machine.

---

## 🚀 How to Run on Any Operating System

### 🪟 Windows (Zero Setup)
1. Unzip `cinepulse-app.zip`.
2. Double-click **`start-windows.bat`** (or right-click `start-windows.ps1` -> *Run with PowerShell*).
3. *Done!* The script automatically downloads portable Node.js (if missing), installs dependencies, opens Google Chrome at `http://localhost:3000`, and starts the engine.

---

### 🍎 macOS & 🐧 Linux (Zero Setup)
1. Open terminal in the unzipped folder.
2. Run:
   ```bash
   ./start-mac-linux.sh
   ```
3. *Done!* The script automatically detects your OS architecture (Apple Silicon / Intel Mac / Linux x64), downloads portable Node.js (if missing), opens your browser at `http://localhost:3000`, and starts the server.

---

### 🐳 Docker (Windows / macOS / Linux)
If you prefer running inside a container:
```bash
docker compose up --build
```
Navigate to `http://localhost:3000` in Google Chrome!

---

## 🛠️ Features Included
- **Stremio-style Media Discovery Catalog**: Real-time trending movies, genre category filters, and search.
- **On-Demand P2P BitTorrent Streaming**: Sequential downloading with instant playback.
- **Native VLC Media Player Integration**: One-click `[Open in VLC]` streaming over HTTP for 100% native Dolby Atmos / DDP 5.1 surround sound decoding and GPU video acceleration on macOS, Windows, and Linux.
- **Security Shield Anti-Malware Guard**: Real-time torrent metadata scanner that automatically deselects and blocks non-media or executable files (`.exe`, `.dmg`, `.pkg`, `.app`, `.command`, `.sh`) from downloading to your disk.
- **Dolby Digital Plus (DDP 5.1 / Atmos / EAC3) & HEVC Auto-Transcode**: Full audio/video compatibility across browsers and external players.
- **Downloads & Offline Disk Storage**: Local playback without internet connection.
- **CineChat Real-Time Watch Party Overlay**: Floating, semi-transparent real-time SSE chat overlay with custom nicknames, 2.5s inactivity auto-hide, incoming message fade-in wake, and fullscreen compatibility.
- **Custom Subtitle Engine**: Auto-fetching OpenSubtitles & custom WebVTT rendering.
