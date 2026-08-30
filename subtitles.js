import zlib from 'zlib';

const OPENSUBTITLES_UA = 'TemporaryUserAgent';

// Supported subtitle languages mapping
export const SUPPORTED_LANGUAGES = [
  { code: 'eng', name: 'English' },
  { code: 'spa', name: 'Spanish' },
  { code: 'fre', name: 'French' },
  { code: 'ger', name: 'German' },
  { code: 'ita', name: 'Italian' },
  { code: 'por', name: 'Portuguese' },
  { code: 'rus', name: 'Russian' },
  { code: 'hin', name: 'Hindi' },
  { code: 'zho', name: 'Chinese' },
  { code: 'jpn', name: 'Japanese' }
];

/**
 * Convert raw SRT subtitle text to WebVTT format
 */
export function srtToVtt(srtText) {
  if (!srtText) return 'WEBVTT\n\n';
  
  // Clean BOM and normalize line endings
  let cleaned = srtText.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');

  // Convert comma timestamp (00:01:20,000) to dot timestamp (00:01:20.000)
  let vttContent = cleaned.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

  return `WEBVTT\n\n${vttContent}`;
}

export class SubtitleService {
  constructor() {
    this.cachedTracks = new Map(); // subId -> WebVTT string content
  }

  /**
   * Search available subtitles for an IMDb ID or Title and language
   */
  async searchSubtitles(query, lang = 'eng') {
    if (!query) return [];

    let url = '';
    if (query.startsWith('tt') || /^\d+$/.test(query)) {
      const cleanImdb = query.replace(/^tt/, '');
      url = `https://rest.opensubtitles.org/search/imdbid-${cleanImdb}/sublanguageid-${lang}`;
    } else {
      url = `https://rest.opensubtitles.org/search/query-${encodeURIComponent(query)}/sublanguageid-${lang}`;
    }

    try {
      const res = await fetch(url, { headers: { 'User-Agent': OPENSUBTITLES_UA } });
      if (!res.ok) return [];

      const list = await res.json();
      if (!Array.isArray(list)) return [];

      return list.slice(0, 15).map(sub => ({
        id: sub.IDSubtitleFile,
        fileName: sub.SubFileName,
        lang: sub.SubLanguageID,
        langName: sub.LanguageName || sub.SubLanguageID,
        downloadUrl: sub.SubDownloadLink,
        rating: sub.SubRating
      }));

    } catch (err) {
      console.error('[Subtitle Service] Search error:', err.message);
      return [];
    }
  }

  /**
   * Download and convert subtitle to WebVTT string
   */
  async getSubtitleVtt(subId, downloadUrl) {
    if (this.cachedTracks.has(subId)) {
      return this.cachedTracks.get(subId);
    }

    try {
      const res = await fetch(downloadUrl, { headers: { 'User-Agent': OPENSUBTITLES_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      let srtText = '';
      try {
        srtText = zlib.gunzipSync(buffer).toString('utf8');
      } catch (e) {
        // If not gzipped, read as raw string
        srtText = buffer.toString('utf8');
      }

      const vtt = srtToVtt(srtText);
      this.cachedTracks.set(subId, vtt);
      return vtt;

    } catch (err) {
      console.error(`[Subtitle Service] Download error for ${subId}:`, err.message);
      throw err;
    }
  }

  /**
   * Store raw uploaded subtitle content
   */
  storeCustomSubtitle(subId, textContent) {
    const vtt = textContent.includes('WEBVTT') ? textContent : srtToVtt(textContent);
    this.cachedTracks.set(subId, vtt);
    return subId;
  }
}
