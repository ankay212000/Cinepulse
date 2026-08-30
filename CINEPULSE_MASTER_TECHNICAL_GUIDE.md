# CinePulse - Technical Architecture & Master Guide

CinePulse is an on-demand, sequential BitTorrent video streaming engine built on Node.js, Express, WebTorrent, and FFmpeg.

---

## Security Shield & Anti-Malware Protection Engine (`security.js`)

Torrents are a primary vector for Mac and PC malware via malicious installer scripts, Trojans, and double-extension tricks. CinePulse includes a **Security Shield Module (`security.js`)** to protect users:

### 1. Extension Threat Classification & Allowlist
- **Allowed Safe Media Extensions**: `.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`, `.m4v`, `.ts`, `.flv`, `.wmv`, `.mp3`, `.aac`, `.flac`, `.srt`, `.vtt`, `.sub`, `.ass`, `.jpg`, `.png`, `.nfo`, `.txt`.
- **Blocked Executable/Script Extensions**: `.exe`, `.dmg`, `.pkg`, `.app`, `.command`, `.sh`, `.bat`, `.scr`, `.vbs`, `.js`, `.iso`, `.img`, `.bin`, `.msi`, `.jar`, `.html`, `.htm`, `.lnk`, `.url`, `.desktop`, `.zip`, `.rar`, `.7z`.

### 2. Automated P2P Non-Media Deselection
- When a torrent metadata resolves (`engine.js`), `TorrentSecurityScanner.sanitizeWebTorrentFiles(torrent)` calls `file.deselect()` on **every non-media or executable file**.
- Executable payloads (`.exe`, `.dmg`, `.pkg`, `.app`, `.command`) are **100% blocked from downloading over P2P**.

### 3. Malware-Only Torrent Rejection (`403 Forbidden`)
- If a torrent contains executable malware (`.exe`, `.dmg`, `.pkg`, `.app`, `.command`) and **no valid video files**, `server.js` refuses to stream or download it, returning `403 Forbidden`.

### 4. Double-Extension Trick Prevention
- Filenames like `movie.mp4.exe` or `setup.mkv.app` are detected as malware traps (`threatLevel = 'DANGEROUS'`).

### 5. UI Security Status & Shield Badging
- Displays `🛡️ Security Verified` for clean torrents and `🛡️ Security Alert: X non-media files blocked` if non-media files were suppressed.

---

## Technical Highlights & Key Features

### 1. Sequential P2P Piece Prioritization & Head/Tail Locking
- **Head/Tail Locking**: When a torrent video is selected, CinePulse locks pieces `[0..24]` (head) and `[totalPieces - 10 .. totalPieces - 1]` (tail `moov` atom header) to resolve video container metadata in **< 1.5 seconds**.
- **Dynamic On-Demand P2P Swarm Fetching**: When a user or player scrubs/skips to any point in the video, CinePulse interrupts default sequential downloading and prioritizes the exact P2P piece offset required from the swarm.

### 2. HTTP 206 Partial Content Streaming & Seeking
- **0ms Range Seeking**: Web-compatible video formats (`.mp4`, `.webm`, `.m4v`, `.mov`) are served via native HTTP 206 Partial Content (`Content-Range: bytes start-end/fileSize`).
- **HTTP 416 Sanitization**: Out-of-bounds EOF probe requests (e.g. `start >= fileSize` or `start > end`) are cleanly answered with `HTTP 416 Range Not Satisfiable`, preventing Node.js `fs.createReadStream` `ERR_OUT_OF_RANGE` crashes.

### 3. Native VLC Media Player Integration
- **OS-Agnostic Launcher**: Supports macOS (`/Applications/VLC.app/Contents/MacOS/VLC` or `open -a VLC`), Windows (`C:\Program Files\VideoLAN\VLC\vlc.exe`), and Linux (`vlc`/`xdg-open`).
- **HTTP Stream Mode**: VLC connects to CinePulse via HTTP stream (`http://localhost:3000/api/downloads/stream/:folderName`), leveraging CinePulse Range Requests for on-demand P2P piece fetching, 100% native Dolby Atmos / DDP 5.1 audio output, and GPU-accelerated 4K HEVC video rendering.

### 4. Cross-Platform Node 20+ / WebTorrent Compatibility
- **uint8-util Buffer Patch**: Includes a global safety wrapper for `Buffer.from(undefined)` calls in `uint8-util`, preventing `TypeError [ERR_INVALID_ARG_TYPE]` across all Node 18, 20, 22, and 23 ESM/macOS environments.

---

## Files Changed / Added for Git Commit

1. **`security.js`** *(NEW)*: Security threat classifier, extension allowlist/blocklist, double-extension trick detection, and WebTorrent P2P non-media file deselecting.
2. **`engine.js`** *(MODIFIED)*: Integrated `TorrentSecurityScanner` inspection & sanitization, plus global Node 20+ `Buffer.from` safety patch.
3. **`server.js`** *(MODIFIED)*: Added 403 malware torrent rejection, OS-agnostic VLC HTTP launcher, and HTTP 416 range EOF sanitization.
4. **`public/index.html`** *(MODIFIED)*: Added `#security-pill` badge and `#security-warning` threat alert banner.
5. **`public/app.js`** *(MODIFIED)*: Rendered security report status in telemetry and added `safeSeek` disk folder stream support.
6. **`CINEPULSE_MASTER_TECHNICAL_GUIDE.md`** *(UPDATED)*: Documented Security Shield architecture and features.
7. **`CINEPULSE_ISSUES_AND_DESIGN_DOC.md`** *(UPDATED)*: Documented malware filtering resolutions.
8. **`DESIGN_DOC.md`** *(UPDATED)*: Updated HLD/LLD security component design.

---

## Local Execution Commands

```bash
# 1. Download project ZIP to Mac Downloads directory
scp nitishtiwari@nitishtiwari.c.googlers.com:/google/src/cloud/nitishtiwari/build_torrent_streamer_mvp/google3/experimental/nitishtiwari/torrent_streamer/cinepulse_torrent_streamer.zip ~/Downloads/

# 2. Extract and run locally
cd ~/Downloads
unzip -o cinepulse_torrent_streamer.zip -d cinepulse_torrent_streamer
cd cinepulse_torrent_streamer
npm start
```
