# CinePulse - Standalone Zero-Setup Web App

A self-contained, cross-platform media streaming application powered by **Node.js, Express, WebTorrent, and HTML5 video**.

> **⚡ Zero-Setup Design**: You do NOT need to manually install Node.js! The launcher scripts will automatically detect, download, and configure a portable Node.js runtime if one is missing on your machine.

---

### 🍎 macOS & 🐧 Linux (Zero Setup)
1. Open terminal in the unzipped folder.
2. Run:
   ```bash
   ./start-mac-linux.sh
   ```
3. *Done!* The script automatically detects your OS architecture (Apple Silicon / Intel Mac / Linux x64), downloads portable Node.js (if missing), opens your browser at `http://localhost:3000`, and starts the server.

---

## 🛠️ Features Included
- **Media Discovery Catalog**: Real-time trending movies, genre category filters, and search.
- **On-Demand P2P BitTorrent Streaming**: Sequential downloading with instant playback.
- **Dolby Digital Plus (DDP 5.1 / Atmos / EAC3) & HEVC Auto-Transcode**: Full audio/video compatibility across browsers.
- **Downloads & Offline Disk Storage**: Local playback without internet connection.
- **Custom Subtitle Engine**: Auto-fetching OpenSubtitles & custom WebVTT rendering.
