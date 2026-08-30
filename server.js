import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { TorrentEngine } from './engine.js';
import { MediaCatalogService } from './catalog.js';
import { SubtitleService, SUPPORTED_LANGUAGES } from './subtitles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Torrent Engine, Media Catalog & Subtitle Service
const engine = new TorrentEngine();
const catalog = new MediaCatalogService();
const subtitleService = new SubtitleService();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.raw({ type: ['application/x-bittorrent', 'application/octet-stream'], limit: '20mb' }));

// Serve static frontend assets from public/ directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Stremio-Style Catalog API: Trending Movies
 */
app.get('/api/catalog/trending', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '24', 10);
    const genre = req.query.genre || null;
    const movies = await catalog.getTrendingMovies(page, limit, genre);
    return res.json({ success: true, page, genre, movies });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Stremio-Style Catalog API: Search Movies
 */
app.get('/api/catalog/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Search query is required' });
  try {
    const movies = await catalog.searchMovies(query);
    return res.json({ success: true, movies });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Stremio-Style Catalog API: Streams / Torrents for Movie
 */
app.get('/api/catalog/streams', async (req, res) => {
  const { imdbId, id, title } = req.query;
  if (!imdbId && !id && !title) return res.status(400).json({ error: 'imdbId, id, or title is required' });
  try {
    const result = await catalog.getMovieStreams(imdbId, id, title);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Subtitle API: Get Supported Languages
 */
app.get('/api/subtitles/languages', (req, res) => {
  return res.json({ languages: SUPPORTED_LANGUAGES });
});

/**
 * Subtitle API: Search Subtitles by IMDb ID & Language
 */
app.get('/api/subtitles/search', async (req, res) => {
  const { imdbId, query, title, lang } = req.query;
  const targetQuery = imdbId || query || title;
  if (!targetQuery) return res.status(400).json({ error: 'imdbId or title is required' });

  try {
    const list = await subtitleService.searchSubtitles(targetQuery, lang || 'eng');
    return res.json({ success: true, subtitles: list });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Subtitle API: Get WebVTT Track Content
 */
app.get('/api/subtitles/track/:subId', async (req, res) => {
  const subId = req.params.subId;
  const downloadUrl = req.query.url;

  try {
    const vttContent = await subtitleService.getSubtitleVtt(subId, downloadUrl);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(vttContent);
  } catch (err) {
    return res.status(500).send('WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n[Failed to load subtitles]\n');
  }
});

/**
 * Subtitle API: Upload Custom SRT/VTT File
 */
app.post('/api/subtitles/upload', express.text({ limit: '10mb' }), (req, res) => {
  try {
    const customId = `custom_${Date.now()}`;
    subtitleService.storeCustomSubtitle(customId, req.body);
    return res.json({ success: true, subId: customId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Add a new torrent (magnet URL string or binary .torrent file buffer)
 */
app.post('/api/torrent/add', async (req, res) => {
  try {
    let torrentInput = null;

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      torrentInput = req.body;
    } else if (req.body && req.body.magnet) {
      torrentInput = req.body.magnet.trim();
    }

    if (!torrentInput) {
      return res.status(400).json({ error: 'Please provide a valid magnet link or .torrent file' });
    }

    console.log('[API] Adding torrent...');
    const status = await engine.addTorrent(torrentInput);
    return res.json({ success: true, torrent: status });

  } catch (err) {
    console.error('[API Error Add Torrent]:', err);
    return res.status(500).json({ error: err.message || 'Failed to add torrent' });
  }
});

/**
 * Get status and real-time telemetry for a torrent
 */
app.get('/api/torrent/status/:infoHash', (req, res) => {
  const infoHash = req.params.infoHash;
  const status = engine.getTorrentStatus(infoHash);
  if (!status) {
    return res.status(404).json({ error: 'Torrent session not found' });
  }
  return res.json(status);
});

/**
 * List all active torrents
 */
app.get('/api/torrents', (req, res) => {
  return res.json({ torrents: engine.listTorrents() });
});

/**
 * Server-Sent Events (SSE) stream for real-time telemetry updates (speed, peers, progress)
 */
app.get('/api/torrent/events/:infoHash', (req, res) => {
  const infoHash = req.params.infoHash;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const interval = setInterval(() => {
    const status = engine.getTorrentStatus(infoHash);
    if (!status) {
      res.write(`data: ${JSON.stringify({ error: 'Torrent not found' })}\n\n`);
      clearInterval(interval);
      return res.end();
    }
    res.write(`data: ${JSON.stringify(status)}\n\n`);
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

/**
 * Switch active video file in torrent for sequential downloading
 */
app.post('/api/torrent/select', (req, res) => {
  const { infoHash, fileIndex } = req.body;
  if (!infoHash || fileIndex === undefined) {
    return res.status(400).json({ error: 'infoHash and fileIndex are required' });
  }
  
  try {
    engine.selectFile(infoHash, parseInt(fileIndex, 10));
    const status = engine.getTorrentStatus(infoHash);
    return res.json({ success: true, torrent: status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Pause P2P Torrent Download
 */
app.post('/api/torrent/pause/:infoHash', (req, res) => {
  const infoHash = req.params.infoHash;
  const ok = engine.pauseTorrent(infoHash);
  return res.json({ success: ok });
});

/**
 * Resume P2P Torrent Download
 */
app.post('/api/torrent/resume/:infoHash', (req, res) => {
  const infoHash = req.params.infoHash;
  const ok = engine.resumeTorrent(infoHash);
  return res.json({ success: ok });
});

/**
 * Stream Endpoint with HTTP 206 Partial Content & Range Header support
 */
async function handleStream(req, res) {
  const infoHash = req.params.infoHash;
  const fileIndex = req.params.fileIndex !== undefined ? parseInt(req.params.fileIndex, 10) : undefined;

  try {
    const torrent = await engine.waitForMetadata(infoHash, 60000);
    const status = engine.getTorrentStatus(infoHash);
    if (!status || !torrent || !torrent.files || torrent.files.length === 0) {
      return res.status(404).json({ error: 'Torrent metadata is still resolving. Please wait...' });
    }

    if (status.security && status.security.threatLevel === 'DANGEROUS' && status.files.filter(f => f.isVideo).length === 0) {
      return res.status(403).json({ error: 'Security Shield Blocked: Malicious torrent contains executable malware and no video streams.' });
    }

    const rangeHeader = req.headers.range;
    let rangeOptions = null;
    
    // Parse Range header if present (e.g. bytes=1000-2000 or bytes=1000-)
    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : undefined;
      rangeOptions = { start, end };
    }

    const startTime = parseFloat(req.query.ss || 0);
    const { stream, file } = engine.createStream(infoHash, fileIndex, rangeOptions);
    const fileSize = file.length;

    const ext = path.extname(file.name).toLowerCase();
    const isDirectPlayable = ['.mp4', '.webm', '.m4v', '.mov'].includes(ext) && req.query.transcode !== 'true';

    if (!isDirectPlayable) {
      console.log(`[FFmpeg Transmuxer] Remuxing ${file.name} (${ext}) [video: ${isX265 ? 'H264-ultrafast' : 'copy'}, audio: AAC, seek: ${startTime}s] for HTML5 web playback...`);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes'
      });

      const ffmpegArgs = [
        '-probesize', '524288',
        '-analyzeduration', '1000000',
        '-fflags', '+nobuffer+fastseek'
      ];

      if (startTime > 0) {
        ffmpegArgs.push('-ss', startTime.toString());
      }

      const videoCodec = (isX265 || req.query.transcodeVideo === 'true') 
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23']
        : ['-c:v', 'copy'];

      const relFilePath = file ? (file.path || file.name) : null;
      const diskFilePath = (relFilePath && engine.cacheDir) ? path.join(engine.cacheDir, relFilePath) : null;
      const useDiskInput = diskFilePath && fs.existsSync(diskFilePath) && fs.statSync(diskFilePath).size > 100000;

      const inputSource = useDiskInput ? ['-i', diskFilePath] : ['-i', 'pipe:0'];

      ffmpegArgs.push(
        ...inputSource,
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        ...videoCodec,
        '-c:a', 'aac',
        '-ac', '2',
        '-ar', '48000',
        '-b:a', '256k',
        '-af', 'volume=1.5',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1'
      );

      const ffmpeg = spawn('ffmpeg', ffmpegArgs);

      stream.on('error', (err) => {
        console.log(`[Stream Error Handled]: ${err.message}`);
      });

      ffmpeg.stdin.on('error', (err) => {});
      ffmpeg.stdout.on('error', (err) => {});
      ffmpeg.on('error', (err) => {
        console.log(`[FFmpeg Error Handled]: ${err.message}`);
      });
      res.on('error', (err) => {
        console.log(`[Response Error Handled]: ${err.message}`);
      });

      if (!useDiskInput) {
        stream.pipe(ffmpeg.stdin);
      }
      ffmpeg.stdout.pipe(res);

      ffmpeg.stderr.on('data', (d) => {});

      req.on('close', () => {
        try { ffmpeg.kill('SIGKILL'); } catch (e) {}
        try { stream.destroy(); } catch (e) {}
      });
      return;
    }

    const mimeType = engine.getMimeType(file.name);
    const fileNameEscaped = encodeURIComponent(file.name);

    if (rangeHeader) {
      let start = rangeOptions.start || 0;
      let end = rangeOptions.end !== undefined ? rangeOptions.end : fileSize - 1;

      if (isNaN(start)) start = 0;
      if (isNaN(end) || end >= fileSize) end = fileSize - 1;

      if (start >= fileSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
          'Access-Control-Allow-Origin': '*'
        });
        return res.end();
      }

      const chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${fileNameEscaped}"`,
        'Access-Control-Allow-Origin': '*'
      });
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `inline; filename="${fileNameEscaped}"`,
        'Access-Control-Allow-Origin': '*'
      });
    }

    if (req.method === 'HEAD') {
      return res.end();
    }

    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('[Stream Pipe Error]:', err.message);
      if (!res.headersSent) {
        res.status(500).send('Streaming error');
      }
    });

    req.on('close', () => {
      try { stream.destroy(); } catch (e) {}
    });

  } catch (err) {
    console.error('[Stream Endpoint Error]:', err.message);
    return res.status(500).send(`Error: ${err.message}`);
  }
}

app.route('/api/stream/:infoHash').get(handleStream).head(handleStream);
app.route('/api/stream/:infoHash/:fileIndex').get(handleStream).head(handleStream);


/**
 * Stop torrent session and destroy temporary disk cache
 */
app.post('/api/torrent/stop/:infoHash', async (req, res) => {
  const infoHash = req.params.infoHash;
  try {
    const success = await engine.destroyTorrent(infoHash);
    return res.json({ success, message: `Torrent ${infoHash} stopped and cache cleared.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Disk Downloads Management APIs
 */
app.get('/api/downloads/list', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const storage = engine.listDownloadedStorage();
    return res.json({ success: true, ...storage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads/delete', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const { folderName } = req.body;
  if (!folderName) return res.status(400).json({ error: 'folderName is required' });

  try {
    const success = await engine.deleteDownloadItem(folderName);
    const updatedStorage = engine.listDownloadedStorage();
    return res.json({ success, message: `Deleted ${folderName}`, ...updatedStorage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads/clear-all', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  try {
    const success = await engine.clearAllDownloads();
    const updatedStorage = engine.listDownloadedStorage();
    return res.json({ success, message: 'All download storage cleared', ...updatedStorage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Open Downloaded File in VLC on Host / Generate M3U Stream
 */
app.post('/api/downloads/open-vlc/:folderName', (req, res) => {
  const folderName = decodeURIComponent(req.params.folderName);
  const targetPath = path.join(engine.cacheDir, folderName);

  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Downloaded folder not found' });
  }

  let filePath = targetPath;
  if (fs.statSync(targetPath).isDirectory()) {
    const subFiles = engine._scanDirFiles(targetPath);
    const videoFile = subFiles.find(f => ['.mp4', '.mkv', '.webm', '.avi', '.ts', '.flv', '.wmv'].includes(path.extname(f.name).toLowerCase()));
    if (!videoFile) return res.status(404).json({ error: 'No video files found' });
    filePath = path.join(targetPath, videoFile.relPath);
  }

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol || 'http';
  const streamUrl = `${protocol}://${host}/api/downloads/stream/${encodeURIComponent(folderName)}`;
  const targetUrl = streamUrl;

  // OS-Agnostic VLC / Default Media Player Launcher
  const platform = process.platform;
  let vlcCmd = 'vlc';
  let vlcArgs = [targetUrl];

  if (platform === 'darwin') { // macOS
    if (fs.existsSync('/Applications/VLC.app/Contents/MacOS/VLC')) {
      vlcCmd = '/Applications/VLC.app/Contents/MacOS/VLC';
      vlcArgs = [targetUrl];
    } else {
      vlcCmd = 'open';
      vlcArgs = ['-a', 'VLC', targetUrl];
    }
  } else if (platform === 'win32') { // Windows
    const winVlcPath = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe';
    if (fs.existsSync(winVlcPath)) {
      vlcCmd = winVlcPath;
      vlcArgs = [targetUrl];
    } else {
      vlcCmd = 'cmd.exe';
      vlcArgs = ['/c', 'start', 'vlc', targetUrl];
    }
  }

  try {
    const child = spawn(vlcCmd, vlcArgs, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      console.log(`[VLC Launch Notice]: ${vlcCmd} direct spawn failed (${err.message}). Falling back to OS default open...`);
      try {
        const fallbackCmd = (platform === 'darwin') ? 'open' : (platform === 'win32' ? 'cmd.exe' : 'xdg-open');
        const fallbackArgs = (platform === 'darwin') ? [filePath] : (platform === 'win32' ? ['/c', 'start', '""', filePath] : [filePath]);
        const fallbackChild = spawn(fallbackCmd, fallbackArgs, { detached: true, stdio: 'ignore' });
        fallbackChild.unref();
      } catch (e) {}
    });
    child.unref();
    return res.json({ success: true, message: `Opening ${path.basename(filePath)} in VLC / Media Player` });
  } catch (err) {
    return res.status(500).json({ error: `Could not launch player: ${err.message}` });
  }
});

app.get('/api/downloads/m3u/:folderName', (req, res) => {
  const folderName = decodeURIComponent(req.params.folderName);
  const host = req.get('host');
  const protocol = req.protocol;
  const streamUrl = `${protocol}://${host}/api/downloads/stream/${encodeURIComponent(folderName)}`;

  const m3uContent = `#EXTM3U\n#EXTINF:-1,${folderName}\n${streamUrl}\n`;
  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', `attachment; filename="${folderName}.m3u"`);
  res.send(m3uContent);
});

/**
 * Direct Disk Stream API (plays any downloaded file directly from disk cache)
 */
async function handleDiskStream(req, res) {
  const folderName = decodeURIComponent(req.params.folderName);
  const targetPath = path.join(engine.cacheDir, folderName);

  if (!fs.existsSync(targetPath)) {
    return res.status(404).send('Downloaded folder not found on disk');
  }

  let filePath = targetPath;
  if (fs.statSync(targetPath).isDirectory()) {
    const subFiles = engine._scanDirFiles(targetPath);
    const videoFile = subFiles.find(f => ['.mp4', '.mkv', '.webm', '.avi', '.ts', '.flv', '.wmv'].includes(path.extname(f.name).toLowerCase()));
    if (!videoFile) return res.status(404).send('No video files found in folder');
    filePath = path.join(targetPath, videoFile.relPath);
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Video file not found');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const isDirectPlayable = ['.mp4', '.webm', '.m4v', '.mov'].includes(ext) && req.query.transcode !== 'true';

  if (!isDirectPlayable) {
    console.log(`[Disk Player] Remuxing local file ${path.basename(filePath)} (${ext}) [video: ${isX265 ? 'H264-ultrafast' : 'copy'}, audio: AAC] for web playback...`);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes'
    });

    const startTime = parseFloat(req.query.ss || 0);

    const videoCodec = (isX265 || req.query.transcodeVideo === 'true') 
      ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '23']
      : ['-c:v', 'copy'];

    const ffmpegArgs = [
      '-probesize', '524288',
      '-analyzeduration', '1000000',
      '-fflags', '+nobuffer+fastseek'
    ];

    if (startTime > 0) {
      ffmpegArgs.push('-ss', startTime.toString());
    }

    ffmpegArgs.push(
      '-i', filePath,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      ...videoCodec,
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '48000',
      '-b:a', '256k',
      '-af', 'volume=1.5',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    );

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', () => {});

    req.on('close', () => {
      try { ffmpeg.kill('SIGKILL'); } catch (e) {}
    });
    return;
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= fileSize) end = fileSize - 1;

    if (start >= fileSize || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end();
    }

    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': engine.getMimeType(filePath),
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (err) => {
      console.log(`[Disk ReadStream Error Handled]: ${err.message}`);
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': engine.getMimeType(filePath),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.log(`[Disk ReadStream Error Handled]: ${err.message}`);
    });
    stream.pipe(res);
  }
}

app.get('/api/downloads/stream/:folderName', handleDiskStream);



// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(` CinePulse Server is running!`);
  console.log(` Local UI:     http://localhost:${PORT}`);
  console.log(` Proxy URL:    http://nitishtiwari.c.googlers.com:${PORT}`);
  console.log(`=================================================`);
});

// Process Crash Protection: Ensure server never dies on uncaught errors or unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[Global Protection] Prevented server crash from uncaught exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Global Protection] Prevented server crash from unhandled rejection:', reason);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down CinePulse server...');
  await engine.destroyAll();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
