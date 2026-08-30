# CinePulse - High-Level & Low-Level Design Architecture Document

CinePulse is an enterprise-grade, on-demand, sequential BitTorrent streaming engine designed for instant video playback of high-resolution 4K HDR media directly from P2P swarms.

---

## 1. High-Level Architecture (HLD)

```
                       ┌─────────────────────────────────────┐
                       │           HTML5 Web UI              │
                       │   (Hero Carousel, Player SPA)       │
                       └──────────────────┬──────────────────┘
                                          │
                                   HTTP 206 / SSE
                                          │
                       ┌──────────────────▼──────────────────┐
                       │          Express Server             │
                       │    (Range Parser, VLC Launcher)     │
                       └──────────┬─────────────────┬────────┘
                                  │                 │
                  HTTP Range / fMP4 │                 │ File Read
                                  │                 │
       ┌──────────────────────────▼────┐       ┌────▼──────────────────────────┐
       │     WebTorrent P2P Engine     │       │    Disk Storage Cache        │
       │ (Piece Lock, Head/Tail Prior) │<─────>│  (/tmp/cinepulse_cache)       │
       └───────────────────────────────┘       └───────────────────────────────┘
```

### Components
1. **Frontend SPA (`public/app.js`, `public/index.html`)**: Interactive video player with 0ms Range seeking feedback, subtitle selection, and hero carousel.
2. **Server Layer (`server.js`)**: Express HTTP 206 range streaming, OS-agnostic VLC launcher, SSE telemetry.
3. **P2P Torrent Engine (`engine.js`)**: WebTorrent client wrapper managing piece prioritization, head/tail atom locking, and swarm communication.

---

## 2. Low-Level Design (LLD)

### Sequential Optimization & Head/Tail Piece Locking
- **BitTorrent Piece Structure**: A 32 GB video is split into 3,894 pieces (8 MB each).
- **MP4 Container Atoms**:
  - `ftyp`: File type atom (bytes 0..32).
  - `moov`: Index sample table describing frame offsets, timestamps, and keyframe maps.
  - `mdat`: Raw audio/video payload frames.
- **Locking Algorithm**:
  - Head Pieces `[0..24]` locked for instant `ftyp` / metadata initialization.
  - Tail Pieces `[totalPieces - 10 .. totalPieces - 1]` locked for tail `moov` atom resolution.
  - Time-To-First-Frame (TTFF): **< 1.5 seconds**.

---

## 3. Streaming & Seeking Protocols

- **HTTP 206 Partial Content**: Direct range streaming with zero CPU transcoding overhead (`-c:v copy`).
- **HTTP 416 Range Not Satisfiable**: EOF probe protection answering `start >= fileSize` cleanly.
- **VLC Media Player Integration**: OS-agnostic spawn (`/Applications/VLC.app/Contents/MacOS/VLC`, `open -a VLC`, `vlc.exe`, `xdg-open`) streaming over HTTP for 100% native Dolby Atmos / DDP 5.1 surround sound.
