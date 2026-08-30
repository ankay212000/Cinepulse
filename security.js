import path from 'path';

/**
 * Dangerous file extensions that indicate malware, trojans, or executable scripts
 */
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dmg', '.pkg', '.app', '.command', '.sh', '.bat', '.cmd', '.scr',
  '.vbs', '.js', '.jar', '.msi', '.iso', '.img', '.bin', '.com', '.cpl', '.gadget',
  '.inf', '.ins', '.inx', '.isu', '.job', '.jse', '.lnk', '.msc', '.msp', '.mst',
  '.paf', '.pif', '.ps1', '.reg', '.rgs', '.sct', '.shb', '.shs', '.u3p', '.vb',
  '.vbe', '.ws', '.wsf', '.wsh', '.html', '.htm', '.url', '.desktop'
]);

const SAFE_MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts', '.flv', '.wmv',
  '.mp3', '.aac', '.flac', '.m4a', '.wav', '.ogg',
  '.srt', '.vtt', '.sub', '.ass', '.idx',
  '.jpg', '.jpeg', '.png', '.webp', '.nfo', '.txt'
]);

export class TorrentSecurityScanner {
  /**
   * Inspect a list of files from a torrent metadata structure and compute security score
   */
  static inspectTorrentFiles(files = []) {
    const report = {
      isSafe: true,
      threatLevel: 'SAFE', // 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS'
      totalFiles: files.length,
      threatsFound: [],
      blockedFilesCount: 0,
      safeMediaFiles: []
    };

    files.forEach(file => {
      const fileName = (file.name || '').trim();
      const ext = path.extname(fileName).toLowerCase();

      // Check double extensions (e.g. movie.mp4.exe or movie.mkv.app)
      const parts = fileName.split('.');
      let isDoubleExtension = false;
      if (parts.length > 2) {
        const secondToLast = '.' + parts[parts.length - 2].toLowerCase();
        if (SAFE_MEDIA_EXTENSIONS.has(secondToLast) && EXECUTABLE_EXTENSIONS.has(ext)) {
          isDoubleExtension = true;
        }
      }

      if (EXECUTABLE_EXTENSIONS.has(ext) || isDoubleExtension) {
        report.isSafe = false;
        report.threatLevel = 'DANGEROUS';
        report.blockedFilesCount++;
        report.threatsFound.push({
          name: fileName,
          extension: ext,
          size: file.length || 0,
          reason: isDoubleExtension 
            ? 'Executable masked as video (Double extension trick)'
            : 'Executable/Installer script file detected'
        });
      } else if (SAFE_MEDIA_EXTENSIONS.has(ext)) {
        report.safeMediaFiles.push(fileName);
      } else {
        // Unknown file extension
        if (report.threatLevel !== 'DANGEROUS') {
          report.threatLevel = 'SUSPICIOUS';
        }
      }
    });

    return report;
  }

  /**
   * Filter WebTorrent files to ensure non-media executable files are DESELECTED from downloading
   */
  static sanitizeWebTorrentFiles(torrentInstance) {
    if (!torrentInstance || !torrentInstance.files) return;

    let blockedCount = 0;
    torrentInstance.files.forEach(file => {
      const ext = path.extname(file.name).toLowerCase();
      
      // If file is an executable or non-media file, deselect it completely from P2P downloading
      if (EXECUTABLE_EXTENSIONS.has(ext) || !SAFE_MEDIA_EXTENSIONS.has(ext)) {
        try {
          file.deselect();
          blockedCount++;
          console.log(`[Security Guard]: Blocked non-media/executable file from P2P download: ${file.name}`);
        } catch (e) {}
      }
    });

    return blockedCount;
  }
}
