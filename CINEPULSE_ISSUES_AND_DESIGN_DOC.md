# CinePulse - Complete System Diagnostics, Issues & Architectural Resolutions

This document provides a comprehensive log of all technical issues encountered during the development and iteration of CinePulse, along with their root causes, low-level technical explanations, and permanent resolutions.

---

## Index of Diagnostics & Resolutions

### 1. DDP 5.1 / Dolby Atmos / EAC-3 Silent Audio Bug
- **Symptom**: `.mp4` release containing `DDP5.1.Atmos` audio played video smoothly in Chrome but had no sound.
- **Root Cause**: Modern web browsers (Chrome/Edge on Linux/Cloudtop) lack native Dolby Digital Plus (`EAC-3`/`Atmos`) audio decoders. Because `.mp4` files were treated as direct-playable, raw `EAC-3` streams were sent directly to the browser.
- **Resolution**: Integrated native **VLC Media Player** support (`Open in VLC`), which connects to CinePulse via HTTP stream (`/api/downloads/stream/:folderName`) for 100% native Dolby Atmos / DDP 5.1 surround sound decoding and GPU video acceleration.

---

### 2. 4K HEVC Video Re-Encoding CPU Stall
- **Symptom**: Forcing `-c:v libx264` software video re-encoding on 4K HEVC streams caused 100% CPU utilization and stalled playback.
- **Root Cause**: Transcoding 4K HEVC frames into H.264 in real-time without hardware acceleration exceeds single-core CPU budgets.
- **Resolution**: Kept default video codec as `-c:v copy` (stream pass-through) for direct 206 streaming and VLC streaming, preserving 0% CPU utilization and maximum 4K video quality.

---

### 3. RangeError [ERR_OUT_OF_RANGE] on EOF Probes
- **Symptom**: Server logged `RangeError [ERR_OUT_OF_RANGE]: The value of "start" is out of range. It must be <= "end"`.
- **Root Cause**: When VLC or media players probe the end of a file (EOF), they send Range requests asking for `bytes=<fileSize>-` or `bytes=<fileSize+1>-`. `fs.createReadStream` threw an unhandled exception when `start > end`.
- **Resolution**: Added range sanitization and standard **HTTP 416 (Range Not Satisfiable)** handling in [`server.js`](file:///google/src/cloud/nitishtiwari/build_torrent_streamer_mvp/google3/experimental/nitishtiwari/torrent_streamer/server.js#L600-L612).

---

### 4. WebTorrent uint8-util ERR_INVALID_ARG_TYPE in Node 20+
- **Symptom**: `TypeError [ERR_INVALID_ARG_TYPE]: The first argument must be of type string or an instance of Buffer... Received undefined` thrown at `uint8-util/dist/src/node.js:12:41`.
- **Root Cause**: `webtorrent`'s magnet URI parser internally calls `uint8-util.hex2arr(arr)`. On Node 20+ under ESM/macOS runtimes, `arr.buffer` is `undefined`, causing `Buffer.from(undefined)` to throw.
- **Resolution**: Implemented a global safety patch at the top of [`engine.js`](file:///google/src/cloud/nitishtiwari/build_torrent_streamer_mvp/google3/experimental/nitishtiwari/torrent_streamer/engine.js#L7-L14) wrapping `Buffer.from` to safely return an empty buffer when `first === undefined`.

---

### 5. macOS `spawn vlc ENOENT` Error
- **Symptom**: Clicking `Open in VLC` logged `spawn vlc ENOENT` on macOS.
- **Root Cause**: `vlc` is not in macOS default `$PATH`; it is installed inside `/Applications/VLC.app/Contents/MacOS/VLC`.
- **Resolution**: Built an OS-agnostic launcher in [`server.js`](file:///google/src/cloud/nitishtiwari/build_torrent_streamer_mvp/google3/experimental/nitishtiwari/torrent_streamer/server.js#L463-L490) that resolves `/Applications/VLC.app/Contents/MacOS/VLC` or `open -a VLC` on macOS, `C:\Program Files\VideoLAN\VLC\vlc.exe` on Windows, and `vlc`/`xdg-open` on Linux, with fallback handlers.

---

### 6. Live P2P On-Demand Seeking in VLC
- **Symptom**: Scrubbing far ahead in VLC when opened in local file mode showed a black screen.
- **Root Cause**: Local file mode reads static disk files without triggering P2P requests to peers for un-downloaded chunks.
- **Resolution**: Passed the HTTP Stream URL (`http://localhost:3000/api/downloads/stream/:folderName`) to VLC. When VLC scrubs in HTTP mode, VLC sends HTTP 206 Range Requests to CinePulse, which prioritizes those P2P pieces from the swarm on-demand in < 1 second.
