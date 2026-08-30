import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { TorrentSecurityScanner } from './security.js';

// Global safety patch for uint8-util arr2hex Buffer.from(undefined) bug in Node 20+
const _origBufferFrom = Buffer.from;
Buffer.from = function (first, ...args) {
  if (first === undefined || first === null) {
    return _origBufferFrom.call(this, '', ...args);
  }
  return _origBufferFrom.call(this, first, ...args);
};

// Common video extensions and MIME types
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts', '.flv', '.wmv'];
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv'
};

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz'
];

function hexToUint8Array(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const cleanHex = hex.trim().toLowerCase();
  if (cleanHex.length % 2 !== 0) return null;
  const arr = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    arr[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return arr;
}

function enhanceMagnetWithTrackers(torrentInput) {
  if (typeof torrentInput !== 'string') {
    return torrentInput;
  }
  let formatted = torrentInput.trim();

  // Convert bare infoHash (40 hex chars or 32 base32 chars) into standard Magnet URI
  if (!formatted.startsWith('magnet:') && !formatted.startsWith('http://') && !formatted.startsWith('https://')) {
    const isHex = /^[a-f0-9]{40}$/i.test(formatted);
    const isBase32 = /^[a-z2-7]{32}$/i.test(formatted);
    if (isHex || isBase32) {
      formatted = `magnet:?xt=urn:btih:${formatted}`;
    }
  }

  if (formatted.startsWith('magnet:')) {
    PUBLIC_TRACKERS.forEach(t => {
      const encoded = encodeURIComponent(t);
      if (!formatted.includes(encoded) && !formatted.includes(t)) {
        formatted += `&tr=${encoded}`;
      }
    });
  }

  return formatted;
}

export class TorrentEngine {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(os.tmpdir(), 'cinepulse_cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    this.client = new WebTorrent({ utp: false, dht: true, webSeeds: true });

    this._ensureClient();
    this.activeTorrents = new Map(); // infoHash -> torrent metadata state
  }

  _ensureClient() {
    if (!this.client || this.client.destroyed) {
      console.log('[Torrent Engine] WebTorrent client instance re-initialized.');
      this.client = new WebTorrent({ utp: false, dht: true, webSeeds: true });
      this.client.on('error', (err) => {
        console.error('[WebTorrent Engine Error]:', err.message);
      });
    }
    return this.client;
  }

  /**
   * Determine MIME type based on file extension
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'video/mp4';
  }

  /**
   * Check if format is natively supported by standard HTML5 video elements in browsers
   */
  isWebPlayable(filePath) {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return ['.mp4', '.webm', '.m4v', '.mov'].includes(ext);
  }

  /**
   * Extract infoHash string from torrent object or magnet input synchronously
   */
  _extractInfoHash(torrentInput, torrentInstance) {
    if (torrentInstance && torrentInstance.infoHash) {
      return torrentInstance.infoHash.toLowerCase();
    }
    if (typeof torrentInput === 'string') {
      const match = torrentInput.match(/btih:([a-f0-9]{40})/i) || torrentInput.match(/btih:([a-z2-7]{32})/i);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  /**
   * Add a torrent (magnet URL or .torrent buffer) with duplicate prevention & metadata listener
   */
  async addTorrent(torrentInput) {
    this._ensureClient();
    const startTime = Date.now();
    const infoHash = this._extractInfoHash(torrentInput);
    const enhancedInput = enhanceMagnetWithTrackers(torrentInput);

    // Check if torrent already exists in WebTorrent client by infoHash
    let existingTorrent = null;
    if (infoHash) {
      try { existingTorrent = await this.client.get(infoHash); } catch (e) {}
    }

    if (existingTorrent && !existingTorrent.destroyed) {
      console.log(`[Torrent Engine] Torrent already active, reusing: ${existingTorrent.name || existingTorrent.infoHash}`);
      
      const torrentInfo = this._registerTorrent(existingTorrent, startTime, enhancedInput);
      if (typeof existingTorrent.on === 'function' && !existingTorrent.ready) {
        existingTorrent.on('metadata', () => this._registerTorrent(existingTorrent, startTime, enhancedInput));
        existingTorrent.on('ready', () => {
          console.log(`[Torrent Engine] Reused torrent ready: ${existingTorrent.name}`);
          this._registerTorrent(existingTorrent, startTime, enhancedInput);
        });
      }
      return torrentInfo;
    }

    // Add fresh torrent to WebTorrent client
    try {
      let torrentId = enhancedInput;
      if (infoHash && infoHash.length === 40) {
        const hex = infoHash.toLowerCase();
        const buf = hexToUint8Array(hex);
        if (buf) {
          torrentId = {
            infoHash: hex,
            infoHashBuffer: buf,
            announce: PUBLIC_TRACKERS
          };
        } else {
          torrentId = hex;
        }
      }
      const torrent = await this.client.add(torrentId, {
        path: this.cacheDir,
        announce: PUBLIC_TRACKERS
      });
      console.log(`[Torrent Engine] Added torrent: ${torrent.name || torrent.infoHash}`);

      torrent.on('error', (err) => console.error(`[Torrent Error] ${err.message}`));
      torrent.on('metadata', () => {
        console.log(`[Torrent Engine] Metadata loaded: ${torrent.name}`);
        this._registerTorrent(torrent, startTime, enhancedInput);
      });
      torrent.on('ready', () => {
        console.log(`[Torrent Engine] Torrent ready: ${torrent.name} (${torrent.infoHash})`);
        this._registerTorrent(torrent, startTime, enhancedInput);
      });

      return this._registerTorrent(torrent, startTime, enhancedInput);

    } catch (err) {
      if (err.message && err.message.includes('duplicate torrent')) {
        const match = err.message.match(/duplicate torrent ([a-f0-9]+)/i);
        const hash = match ? match[1] : infoHash;
        if (hash) {
          const dup = await this.client.get(hash);
          if (dup) {
            return this._registerTorrent(dup, startTime, enhancedInput);
          }
        }
      }
      throw err;
    }
  }

  /**
   * Process and register torrent metadata and file selection logic
   */
  _registerTorrent(torrent, startTime, torrentInput = null) {
    const infoHash = this._extractInfoHash(torrentInput, torrent) || (torrent ? torrent.infoHash : null) || 'pending';

    if (!torrent || !torrent.files || torrent.files.length === 0) {
      const pendingState = {
        infoHash,
        name: (torrent && torrent.name) || 'Resolving Metadata...',
        status: 'finding_peers',
        startTime: startTime || Date.now(),
        ttff: null,
        files: [],
        torrentInstance: torrent
      };
      this.activeTorrents.set(infoHash, pendingState);
      const { torrentInstance, ...cleanStatus } = pendingState;
      return cleanStatus;
    }

    // Map all files preserving exact 1-to-1 index matching
    const stateFiles = torrent.files.map((file, index) => {
      const ext = path.extname(file.name).toLowerCase();
      const isVideo = VIDEO_EXTENSIONS.includes(ext);
      return {
        index,
        name: file.name,
        path: file.path,
        length: file.length,
        extension: ext,
        isVideo,
        mimeType: this.getMimeType(file.name),
        isWebPlayable: this.isWebPlayable(file.name)
      };
    });

    // Pick largest video file by default
    const videoFiles = stateFiles.filter(f => f.isVideo);
    let selectedFileIndex = 0;
    if (videoFiles.length > 0) {
      const largestFile = videoFiles.reduce((prev, curr) => (curr.length > prev.length ? curr : prev), videoFiles[0]);
      selectedFileIndex = largestFile.index;
    }

    // Perform Security Inspection & Deselect Non-Media Files
    const securityReport = TorrentSecurityScanner.inspectTorrentFiles(torrent.files);
    TorrentSecurityScanner.sanitizeWebTorrentFiles(torrent);

    const state = {
      infoHash,
      name: torrent.name,
      status: 'metadata_loaded',
      startTime: startTime || Date.now(),
      ttff: null,
      selectedFileIndex,
      files: stateFiles,
      selectedFile: stateFiles[selectedFileIndex],
      security: securityReport,
      downloaded: 0,
      totalSize: torrent.length,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress: 0,
      numPeers: torrent.numPeers || 0,
      torrentInstance: torrent
    };

    this.activeTorrents.set(infoHash, state);

    // Set sequential downloading strategy on selected file
    this.selectFile(infoHash, selectedFileIndex);

    return this.getTorrentStatus(infoHash);
  }

  /**
   * Select a specific file index for sequential downloading and head/tail piece prioritization
   */
  selectFile(infoHash, fileIndex) {
    const state = this.activeTorrents.get(infoHash);
    if (!state || !state.torrentInstance) return;

    const torrent = state.torrentInstance;
    if (!torrent.files || !torrent.files[fileIndex]) return;

    const file = torrent.files[fileIndex];

    state.selectedFileIndex = fileIndex;

    // Select target file with high priority while keeping full torrent downloading active
    file.select();

    // Prioritize first 25 pieces (25-35s video header/buffer) and last 10 pieces (index/metadata)
    const numPieces = torrent.pieces ? torrent.pieces.length : 0;
    if (numPieces > 0) {
      const headPieces = Math.min(25, numPieces);
      const tailPieces = Math.min(10, numPieces);

      for (let i = 0; i < headPieces; i++) {
        torrent.select(i, i, 1);
      }
      for (let i = numPieces - tailPieces; i < numPieces; i++) {
        torrent.select(i, i, 1);
      }

      console.log(`[Sequential Optimization] Torrent ${infoHash} File ${file.name}: Prioritizing Head pieces [0-${headPieces - 1}] & Tail pieces [${numPieces - tailPieces}-${numPieces - 1}], downloading full torrent...`);
    }
  }

  /**
   * Async helper to wait for torrent metadata resolution before streaming
   */
  async waitForMetadata(infoHash, timeoutMs = 15000) {
    this._ensureClient();
    return new Promise(async (resolve) => {
      const state = this.activeTorrents.get(infoHash);
      let torrent = state ? state.torrentInstance : null;
      if (!torrent) {
        try { torrent = await this.client.get(infoHash); } catch (e) {}
      }

      if (torrent && torrent.ready && torrent.files && torrent.files.length > 0) {
        return resolve(torrent);
      }

      if (!torrent) return resolve(null);

      let timer = setTimeout(() => {
        resolve(torrent.ready ? torrent : null);
      }, timeoutMs);

      if (typeof torrent.once === 'function') {
        torrent.once('ready', () => {
          clearTimeout(timer);
          resolve(torrent);
        });
        torrent.once('metadata', () => {
          clearTimeout(timer);
          resolve(torrent);
        });
      } else if (typeof torrent.on === 'function') {
        const handler = () => {
          clearTimeout(timer);
          resolve(torrent);
        };
        torrent.on('ready', handler);
        torrent.on('metadata', handler);
      }
    });
  }

  /**
   * Create node ReadStream for HTTP 206 Partial Content range requests
   */
  createStream(infoHash, fileIndex, range = null) {
    const state = this.activeTorrents.get(infoHash);
    if (!state || !state.torrentInstance) {
      throw new Error(`Torrent ${infoHash} not found in active session map`);
    }

    const torrent = state.torrentInstance;
    if (!torrent.files) {
      throw new Error(`Torrent ${infoHash} metadata is still resolving`);
    }

    let targetIndex = fileIndex !== undefined ? parseInt(fileIndex, 10) : state.selectedFileIndex;
    let file = torrent.files[targetIndex];

    // Enforce video file selection: If requested file is not a video, auto-redirect to state.selectedFileIndex (the main movie file)
    if (file) {
      const ext = path.extname(file.name).toLowerCase();
      const isVideo = VIDEO_EXTENSIONS.includes(ext);
      if (!isVideo && state.selectedFileIndex !== undefined && torrent.files[state.selectedFileIndex]) {
        console.log(`[Stream Override] File index ${targetIndex} (${file.name}) is not a video. Redirecting to video index ${state.selectedFileIndex} (${torrent.files[state.selectedFileIndex].name})`);
        targetIndex = state.selectedFileIndex;
        file = torrent.files[targetIndex];
      }
    }

    if (!file) {
      throw new Error(`File index ${targetIndex} not found in torrent ${infoHash}`);
    }

    // Record TTFF (Time-To-First-Frame) on first stream request
    if (!state.ttff) {
      state.ttff = ((Date.now() - state.startTime) / 1000).toFixed(2);
      console.log(`[TTFF Benchmark] Time-to-first-frame for ${torrent.name}: ${state.ttff} seconds`);
    }

    // Configure options for createReadStream
    const streamOpts = {};
    if (range) {
      if (typeof range.start === 'number') streamOpts.start = range.start;
      if (typeof range.end === 'number') streamOpts.end = range.end;
    }

    console.log(`[Stream Request] ${file.name} (Bytes: ${streamOpts.start || 0} - ${streamOpts.end || file.length - 1})`);
    
    const stream = file.createReadStream(streamOpts);

    if (!state.activeStreams) state.activeStreams = new Set();
    state.activeStreams.add(stream);

    const cleanup = () => {
      if (state.activeStreams) state.activeStreams.delete(stream);
    };

    stream.on('close', cleanup);
    stream.on('end', cleanup);
    stream.on('error', cleanup);

    if (state.isPaused || state.status === 'paused') {
      try { stream.pause(); } catch (e) {}
    }

    return {
      stream,
      file: {
        name: file.name,
        length: file.length,
        mimeType: this.getMimeType(file.name),
        isWebPlayable: this.isWebPlayable(file.name)
      }
    };
  }

  /**
   * Get real-time status and telemetry for a torrent
   */
  getTorrentStatus(infoHash) {
    const state = this.activeTorrents.get(infoHash);
    let torrent = state ? state.torrentInstance : null;
    if (!torrent) {
      try { torrent = this.client.get(infoHash); } catch (e) {}
    }

    if (!torrent) return null;

    if (torrent.ready && torrent.files && torrent.files.length > 0) {
      if (!state || !state.files || state.files.length === 0) {
        this._registerTorrent(torrent, state ? state.startTime : Date.now());
      }
    }

    const updatedState = this.activeTorrents.get(infoHash) || state || {};

    if (!torrent.ready || !updatedState.files || updatedState.files.length === 0) {
      return {
        infoHash: torrent.infoHash || infoHash,
        name: torrent.name || updatedState.name || 'Resolving Metadata...',
        status: 'finding_peers',
        numPeers: torrent.numPeers || 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        progress: 0,
        downloaded: 0,
        totalSize: 0,
        ttff: updatedState.ttff || null,
        files: updatedState.files || []
      };
    }

    const currentFileIndex = updatedState.selectedFileIndex || 0;
    const selectedFile = updatedState.files.find(f => f.index === currentFileIndex) || updatedState.files[0];
    const isPaused = updatedState.status === 'paused' || updatedState.isPaused;

    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      status: isPaused ? 'paused' : (torrent.progress === 1 ? 'completed' : (torrent.downloadSpeed > 0 ? 'streaming' : 'buffering')),
      numPeers: torrent.numPeers || 0,
      downloadSpeed: isPaused ? 0 : (torrent.downloadSpeed || 0), // bytes/sec
      uploadSpeed: isPaused ? 0 : (torrent.uploadSpeed || 0),     // bytes/sec
      progress: torrent.progress || 0,           // 0 to 1
      downloaded: torrent.downloaded || 0,
      totalSize: torrent.length || 0,
      timeRemaining: isPaused ? 0 : (torrent.timeRemaining || 0),
      ttff: updatedState.ttff,
      selectedFileIndex: currentFileIndex,
      selectedFile: selectedFile,
      files: updatedState.files
    };
  }

  /**
   * Pause P2P torrent download (Hard zero bandwidth stop)
   */
  pauseTorrent(infoHash) {
    const state = this.activeTorrents.get(infoHash);
    if (state && state.torrentInstance) {
      const torrent = state.torrentInstance;
      state.isPaused = true;
      state.status = 'paused';

      // 1. Pause active HTTP read streams so no bytes are pulled by video player
      if (state.activeStreams) {
        state.activeStreams.forEach(stream => {
          try { if (typeof stream.pause === 'function') stream.pause(); } catch (e) {}
        });
      }

      // 2. Deselect all piece priorities completely
      if (torrent.pieces && typeof torrent.deselect === 'function') {
        try { torrent.deselect(0, torrent.pieces.length - 1, 0); } catch (e) {}
      }

      // 3. Destroy all active peer wires to force 100% hard zero bandwidth
      if (Array.isArray(torrent.wires)) {
        torrent.wires.forEach(wire => {
          try { wire.destroy(); } catch (e) {}
        });
      }

      // 4. Pause internal torrent & swarm engines
      if (typeof torrent.pause === 'function') {
        try { torrent.pause(); } catch (e) {}
      }
      if (torrent.swarm && typeof torrent.swarm.pause === 'function') {
        try { torrent.swarm.pause(); } catch (e) {}
      }

      console.log(`[Torrent Engine] Hard paused download for torrent ${infoHash} (Destroyed wires, 0 KB/s enforced)`);
      return true;
    }
    return false;
  }

  /**
   * Resume P2P torrent download (Re-discovers peers via DHT/trackers)
   */
  resumeTorrent(infoHash) {
    const state = this.activeTorrents.get(infoHash);
    if (state && state.torrentInstance) {
      const torrent = state.torrentInstance;
      state.isPaused = false;
      state.status = 'streaming';

      // 1. Resume active HTTP read streams
      if (state.activeStreams) {
        state.activeStreams.forEach(stream => {
          try { if (typeof stream.resume === 'function') stream.resume(); } catch (e) {}
        });
      }

      // 2. Resume internal torrent & swarm engine
      if (typeof torrent.resume === 'function') {
        try { torrent.resume(); } catch (e) {}
      }
      if (torrent.swarm && typeof torrent.swarm.resume === 'function') {
        try { torrent.swarm.resume(); } catch (e) {}
      }

      // 3. Re-enable piece selection priority
      if (torrent.pieces && typeof torrent.select === 'function') {
        try { torrent.select(0, torrent.pieces.length - 1, 1); } catch (e) {}
      }

      // 4. Re-apply sequential head/tail optimization
      if (state.selectedFileIndex !== undefined) {
        try { this.selectFile(infoHash, state.selectedFileIndex); } catch (e) {}
      }

      // 5. Re-announce to trackers & DHT to re-discover P2P swarm peers
      if (typeof torrent.discovery === 'object' && torrent.discovery && typeof torrent.discovery.resume === 'function') {
        try { torrent.discovery.resume(); } catch (e) {}
      }

      console.log(`[Torrent Engine] Resuming P2P torrent ${infoHash} (Re-discovering swarm peers via DHT/trackers...)`);
      return true;
    }
    return false;
  }

  /**
   * List all active torrents
   */
  listTorrents() {
    const list = [];
    for (const infoHash of this.activeTorrents.keys()) {
      const status = this.getTorrentStatus(infoHash);
      if (status) list.push(status);
    }
    return list;
  }

  /**
   * Destroy torrent instance and delete temporary downloaded cache from disk
   */
  destroyTorrent(infoHash) {
    return new Promise((resolve) => {
      const state = this.activeTorrents.get(infoHash);
      let torrentName = state ? state.name : null;

      if (!infoHash || infoHash === 'all') {
        this.client.torrents.forEach(t => {
          try { t.destroy({ destroyStore: true }); } catch (e) {}
        });
        this.activeTorrents.clear();
        try { fs.rmSync(this.cacheDir, { recursive: true, force: true }); } catch (e) {}
        console.log('[Cleanup Success] Destroyed all active torrent sessions & disk caches.');
        return resolve(true);
      }

      let torrent = (state && state.torrentInstance);
      if (!torrent) {
        try { torrent = this.client.get(infoHash); } catch (e) {}
      }
      if (torrent && torrent.name) {
        torrentName = torrent.name;
      }

      this.activeTorrents.delete(infoHash);

      const deleteLocalFiles = () => {
        if (torrentName) {
          const folderPath = path.join(this.cacheDir, torrentName);
          if (fs.existsSync(folderPath)) {
            try {
              fs.rmSync(folderPath, { recursive: true, force: true });
              console.log(`[Disk Storage] Force deleted download folder from local disk: ${torrentName}`);
            } catch (err) {
              console.error(`[Disk Storage Error] Failed to delete folder ${torrentName}:`, err);
            }
          }
        }
      };

      if (torrent && typeof torrent.destroy === 'function') {
        try {
          torrent.destroy({ destroyStore: true }, (err) => {
            deleteLocalFiles();
            console.log(`[Cleanup Success] Destroyed torrent ${infoHash} and cleared temporary disk cache.`);
            resolve(true);
          });
        } catch (e) {
          deleteLocalFiles();
          resolve(true);
        }
      } else {
        deleteLocalFiles();
        resolve(true);
      }
    });
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * List all downloaded movies/files stored on disk in cacheDir
   */
  listDownloadedStorage() {
    if (!fs.existsSync(this.cacheDir)) return { totalBytes: 0, items: [] };

    let totalBytes = 0;
    const items = [];

    try {
      const dirEntries = fs.readdirSync(this.cacheDir, { withFileTypes: true });

      for (const entry of dirEntries) {
        const fullPath = path.join(this.cacheDir, entry.name);
        
        let itemSize = 0;
        const videoFiles = [];

        if (entry.isDirectory()) {
          const subFiles = this._scanDirFiles(fullPath);
          itemSize = subFiles.reduce((acc, f) => acc + f.size, 0);
          subFiles.forEach(f => {
            const ext = path.extname(f.name).toLowerCase();
            if (VIDEO_EXTENSIONS.includes(ext)) {
              videoFiles.push({
                name: f.name,
                relPath: f.relPath,
                size: f.size,
                formattedSize: this.formatBytes(f.size)
              });
            }
          });
        } else {
          try {
            const stats = fs.statSync(fullPath);
            itemSize = stats.size;
            const ext = path.extname(entry.name).toLowerCase();
            if (VIDEO_EXTENSIONS.includes(ext)) {
              videoFiles.push({
                name: entry.name,
                relPath: entry.name,
                size: itemSize,
                formattedSize: this.formatBytes(itemSize)
              });
            }
          } catch (e) {}
        }

        totalBytes += itemSize;

        // Check if matching an active torrent in memory
        let activeInfoHash = null;
        let isStreaming = false;

        for (const [hash, state] of this.activeTorrents.entries()) {
          if (state.name && (state.name === entry.name || entry.name.includes(state.name))) {
            activeInfoHash = hash;
            isStreaming = true;
            break;
          }
        }

        items.push({
          folderName: entry.name,
          title: entry.name,
          sizeBytes: itemSize,
          formattedSize: this.formatBytes(itemSize),
          videoFiles,
          isStreaming,
          infoHash: activeInfoHash
        });
      }

    } catch (err) {
      console.error('[Storage List Error]:', err.message);
    }

    // Sort items by disk size descending
    items.sort((a, b) => b.sizeBytes - a.sizeBytes);

    return {
      totalBytes,
      formattedTotalBytes: this.formatBytes(totalBytes),
      items
    };
  }

  _scanDirFiles(dirPath, rootDir = dirPath) {
    let files = [];
    try {
      const list = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of list) {
        const itemPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          files = files.concat(this._scanDirFiles(itemPath, rootDir));
        } else {
          try {
            const stats = fs.statSync(itemPath);
            files.push({
              name: item.name,
              relPath: path.relative(rootDir, itemPath),
              size: stats.size
            });
          } catch (e) {}
        }
      }
    } catch (e) {}
    return files;
  }

  /**
   * Delete a specific downloaded item from disk cache
   */
  async deleteDownloadItem(folderName) {
    if (!folderName) return true;

    // Sanitize folderName to prevent path traversal issues
    const safeFolderName = path.basename(folderName);
    const targetPath = path.join(this.cacheDir, safeFolderName);

    // Stop matching active torrent if running
    for (const [hash, state] of this.activeTorrents.entries()) {
      if (state.name && (state.name === safeFolderName || safeFolderName.includes(state.name) || state.name.includes(safeFolderName))) {
        try {
          await this.destroyTorrent(hash);
        } catch (e) {}
      }
    }

    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
        console.log(`[Disk Storage] Successfully deleted: ${safeFolderName}`);
      }
      return true;
    } catch (err) {
      console.error(`[Disk Storage Error] fs.rmSync failed for ${safeFolderName}, attempting fallback:`, err.message);
      try {
        execSync(`rm -rf "${targetPath.replace(/"/g, '\\"')}"`);
        return true;
      } catch (e) {
        console.error(`[Disk Storage Error] Fallback delete failed:`, e.message);
        return false;
      }
    }
  }

  /**
   * Clear all downloads from disk cache
   */
  async clearAllDownloads() {
    await this.destroyAll();
    if (fs.existsSync(this.cacheDir)) {
      try {
        execSync(`rm -rf "${this.cacheDir}"/*`);
        console.log('[Disk Storage] Force cleared all download storage files using shell rm -rf.');
      } catch (err) {
        console.error('[Disk Storage Clear Error]:', err.message);
      }
    }

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    this._ensureClient();
    return true;
  }

  /**
   * Stop all torrents and destroy engine
   */
  destroyAll() {
    return new Promise((resolve) => {
      const hashes = Array.from(this.activeTorrents.keys());
      Promise.all(hashes.map(hash => this.destroyTorrent(hash))).then(() => {
        if (this.client && !this.client.destroyed) {
          this.client.destroy((err) => {
            if (err) console.error('[Engine Destroy Error]:', err);
            console.log('[Engine] All torrent instances and client destroyed cleanly.');
            this.activeTorrents.clear();
            this._ensureClient();
            resolve();
          });
        } else {
          this.activeTorrents.clear();
          this._ensureClient();
          resolve();
        }
      });
    });
  }
}
