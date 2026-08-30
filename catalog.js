// Active YTS API mirror domain endpoints
const YTS_MIRRORS = [
  'https://yts.lt',
  'https://yts.am',
  'https://yts.do',
  'https://yts.rs'
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'wss://tracker.openwebtorrent.com'
];

/**
 * Helper to format raw byte count into human readable strings
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Generate a magnet URL from an infoHash and display name
 */
export function buildMagnetLink(infoHash, name = 'Media Stream') {
  const encodedName = encodeURIComponent(name);
  const trackerParams = TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedName}&${trackerParams}`;
}

export class MediaCatalogService {
  /**
   * Helper to fetch JSON from mirrors with automatic fallback
   */
  async _fetchFromMirrors(path) {
    for (const mirror of YTS_MIRRORS) {
      try {
        const url = `${mirror}${path}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

        const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'ok') {
            return data;
          }
        }
      } catch (err) {
        // Try next mirror
      }
    }
    return null;
  }

  /**
   * Fetch Trending Movies with Perfectly Balanced Rating & Recency Weighting:
   * - 35% IMDb Rating Weight (High Quality & Acclaim)
   * - 35% Recency Weight (Latest Releases)
   * - 20% Mainstream Popularity Weight (Download & Viewership Count)
   * - 10% Direct Trailer Availability Boost
   * - 85% Score Penalty for Documentary & Music Genres (Listed Lowest in Priority)
   * - Optional Genre Category Filtering
   */
  async getTrendingMovies(page = 1, limit = 24, genre = null) {
    const genreQuery = (genre && genre !== 'all') ? `&genre=${encodeURIComponent(genre)}` : '';

    // Fetch candidate pools from Rating, Year, and Popularity endpoints
    const [p1, p2, p3] = await Promise.all([
      this._fetchFromMirrors(`/api/v2/list_movies.json?sort_by=rating&order_by=desc&page=${page}&limit=40${genreQuery}`),
      this._fetchFromMirrors(`/api/v2/list_movies.json?sort_by=year&order_by=desc&page=${page}&limit=40${genreQuery}`),
      this._fetchFromMirrors(`/api/v2/list_movies.json?sort_by=download_count&order_by=desc&page=${page}&limit=40${genreQuery}`)
    ]);

    const rawList = [];
    if (p1 && p1.data && p1.data.movies) rawList.push(...p1.data.movies);
    if (p2 && p2.data && p2.data.movies) rawList.push(...p2.data.movies);
    if (p3 && p3.data && p3.data.movies) rawList.push(...p3.data.movies);

    // Deduplicate candidates by ID
    const seen = new Set();
    const uniqueMovies = [];
    for (const m of rawList) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        uniqueMovies.push(m);
      }
    }

    if (uniqueMovies.length > 0) {
      const currentYear = new Date().getFullYear();

      // Perfectly Balanced Rating & Recency Recommendation Score:
      // 35% IMDb Rating Weight (High Quality)
      // 35% Recency Weight (Latest Movies)
      // 20% Popularity Weight (Download & Viewership Count)
      // 10% Direct Trailer Availability Boost
      uniqueMovies.forEach(m => {
        const rating = parseFloat(m.rating || 0);
        const year = parseInt(m.year || 2000, 10);
        const downloads = parseFloat(m.download_count || 0);
        const hasNativeTrailer = (m.yt_trailer_code && String(m.yt_trailer_code).trim().length > 0) ? 1.0 : 0.0;

        const ratingNorm = Math.min(1.0, Math.max(0.0, rating / 10.0));
        const yearNorm = Math.min(1.0, Math.max(0.0, (year - 1970) / (currentYear - 1970)));
        const popNorm = downloads > 0 ? Math.min(1.0, Math.log10(downloads + 1) / 7.0) : 0.5;

        let baseScore = (0.40 * ratingNorm) + (0.40 * yearNorm) + (0.19 * popNorm) + (0.01 * hasNativeTrailer);

        // Deprioritize Documentary & Music genres (Listed Lowest in Priority)
        const genresLower = (m.genres || []).map(g => String(g).toLowerCase());
        const isDocOrMusic = genresLower.includes('documentary') || genresLower.includes('music');
        if (isDocOrMusic) {
          baseScore *= 0.15; // 85% score penalty so documentaries & music list at the bottom
        }

        m._score = baseScore;
      });

      // Sort candidate movies descending by balanced composite score
      uniqueMovies.sort((a, b) => b._score - a._score);

      return uniqueMovies.slice(0, limit).map(m => this._formatYtsMovie(m));
    }
    
    // Cinemeta Fallback
    return this._getCinemetaFallback();
  }

  /**
   * Search movies by query keyword
   */
  async searchMovies(query) {
    if (!query || !query.trim()) return [];
    const q = encodeURIComponent(query.trim());
    
    const data = await this._fetchFromMirrors(`/api/v2/list_movies.json?query_term=${q}&limit=24`);
    if (data && data.data && data.data.movies) {
      return data.data.movies.map(m => this._formatYtsMovie(m));
    }

    // Try Cinemeta search fallback if mirrors fail
    return this._searchCinemetaFallback(query);
  }

  /**
   * Resolve streams (torrents/magnets) for a specific movie with Multi-Layer Fallback & Apibay/TPB Global Indexer
   */
  async getMovieStreams(imdbId, movieId = null, title = null) {
    let data = null;

    if (imdbId) {
      data = await this._fetchFromMirrors(`/api/v2/movie_details.json?imdb_id=${imdbId}&with_images=true`);
    }

    if ((!data || !data.data || !data.data.movie || !data.data.movie.torrents || data.data.movie.torrents.length === 0) && movieId) {
      data = await this._fetchFromMirrors(`/api/v2/movie_details.json?movie_id=${movieId}&with_images=true`);
    }

    const cleanTitle = title ? title.replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim() : '';

    // Fallback 1: Search YTS by exact Title if IMDb ID returned 0 torrents
    if ((!data || !data.data || !data.data.movie || !data.data.movie.torrents || data.data.movie.torrents.length === 0) && cleanTitle) {
      const searchData = await this._fetchFromMirrors(`/api/v2/list_movies.json?query_term=${encodeURIComponent(cleanTitle)}&limit=10`);
      if (searchData && searchData.data && searchData.data.movies && searchData.data.movies.length > 0) {
        const matched = searchData.data.movies.find(m => m.torrents && m.torrents.length > 0) || searchData.data.movies[0];
        if (matched && matched.torrents && matched.torrents.length > 0) {
          data = { data: { movie: matched } };
        }
      }
    }

    let streams = [];

    // Parse YTS torrent results if present
    if (data && data.data && data.data.movie && data.data.movie.torrents && data.data.movie.torrents.length > 0) {
      const movie = data.data.movie;
      streams = (movie.torrents || []).map(t => {
        const infoHash = t.hash;
        const magnet = buildMagnetLink(infoHash, `${movie.title} (${t.quality} ${t.type ? t.type.toUpperCase() : ''})`);
        return {
          infoHash: infoHash.toLowerCase(),
          quality: t.quality || '1080p',
          type: t.type || 'bluray',
          codec: t.video_codec || 'x264',
          sizeBytes: t.size_bytes || 0,
          sizeFormatted: t.size || '1.5 GB',
          seeds: t.seeds !== undefined ? parseInt(t.seeds, 10) : 10,
          peers: t.peers ? parseInt(t.peers, 10) : 0,
          magnetUrl: magnet,
          title: `${movie.title} - ${t.quality} [${t.type ? t.type.toUpperCase() : 'BLURAY'}]`
        };
      });
    }

    // Always query Apibay API for high-health active releases
    if (cleanTitle || imdbId) {
      try {
        const searchQuery = cleanTitle || imdbId;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        
        const apibayRes = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(searchQuery)}`, { signal: controller.signal });
        clearTimeout(timeout);

        if (apibayRes.ok) {
          const apibayData = await apibayRes.json();
          if (Array.isArray(apibayData) && apibayData.length > 0 && apibayData[0].id !== '0') {
            const extraStreams = apibayData.slice(0, 15).map(item => {
              const hash = item.info_hash.toLowerCase();
              const sizeNum = parseInt(item.size || 0, 10);
              const seedsNum = parseInt(item.seeders || 0, 10);
              const nameStr = item.name || title || 'HD Release';
              
              let detectedQuality = '1080p';
              if (nameStr.includes('2160p') || nameStr.includes('4K') || nameStr.includes('4k')) detectedQuality = '2160p';
              else if (nameStr.includes('720p')) detectedQuality = '720p';
              else if (nameStr.includes('480p')) detectedQuality = '480p';

              let detectedCodec = 'x264';
              if (nameStr.includes('x265') || nameStr.includes('hevc') || nameStr.includes('HEVC')) detectedCodec = 'x265';

              const magnet = buildMagnetLink(hash, nameStr);
              return {
                infoHash: hash,
                quality: detectedQuality,
                type: 'WEB-DL',
                codec: detectedCodec,
                sizeBytes: sizeNum,
                sizeFormatted: formatBytes(sizeNum),
                seeds: seedsNum,
                peers: parseInt(item.leechers || 0, 10),
                magnetUrl: magnet,
                title: nameStr
              };
            });
            streams.push(...extraStreams);
          }
        }
      } catch (err) {
        console.warn('Apibay scraper error:', err.message);
      }
    }

    // Deduplicate streams by infoHash
    const streamMap = new Map();
    streams.forEach(st => {
      if (!streamMap.has(st.infoHash) || st.seeds > streamMap.get(st.infoHash).seeds) {
        streamMap.set(st.infoHash, st);
      }
    });

    streams = Array.from(streamMap.values());

    // Sort streams descending by seeders count so active releases float to top!
    streams.sort((a, b) => b.seeds - a.seeds);

    const formattedMovie = (data && data.data && data.data.movie) 
      ? this._formatYtsMovie(data.data.movie) 
      : { id: imdbId, imdbId, title: title || 'Selected Title', year: '', rating: '--', genres: [], summary: '', poster: '', backdrop: '', torrentCount: streams.length, hasHighQuality: true };

    return {
      movie: formattedMovie,
      streams
    };
  }

  /**
   * Format YTS Movie object with 100% trailer fallback support
   */
  _formatYtsMovie(m) {
    const hasHighQuality = (m.torrents || []).some(t => 
      (t.quality && (t.quality.includes('2160p') || t.quality.includes('4K'))) ||
      (t.video_codec && (t.video_codec.includes('x265') || t.video_codec.includes('hevc')))
    ) || (parseFloat(m.rating || 0) >= 6.8);

    const ytCode = m.yt_trailer_code || '';
    const searchQuery = encodeURIComponent(`${m.title || m.name} ${m.year || ''} official trailer`);

    const rawRating = parseFloat(m.rating || m.imdbRating || m.vote_average || 0);
    const formattedRating = (rawRating > 0) ? rawRating.toFixed(1) : '';

    return {
      id: m.id,
      imdbId: m.imdb_code || m.id,
      title: m.title || m.name,
      year: m.year || '',
      rating: formattedRating,
      runtime: m.runtime || 0,
      genres: m.genres || m.genre || [],
      summary: m.summary || m.description_full || m.description_intro || m.description || 'No summary available.',
      poster: m.large_cover_image || m.medium_cover_image || m.poster,
      backdrop: m.background_image_original || m.large_screenshot_image1 || m.background_image || m.large_cover_image || m.poster,
      torrentCount: m.torrents ? m.torrents.length : 1,
      hasHighQuality: hasHighQuality,
      trailerCode: ytCode,
      // Unmuted Audio Trailer Embed URL with Search Fallback
      trailerEmbedUrl: ytCode 
        ? `https://www.youtube.com/embed/${ytCode}?autoplay=1&mute=0&controls=0&modestbranding=1&loop=1&playlist=${ytCode}&enablejsapi=1&playsinline=1`
        : `https://www.youtube.com/embed?listType=search&list=${searchQuery}&autoplay=1&mute=0&controls=0&modestbranding=1&enablejsapi=1&playsinline=1`
    };
  }

  /**
   * Fallback using Cinemeta public catalog with YouTube Search Fallback Trailers
   */
  async _getCinemetaFallback() {
    try {
      const res = await fetch('https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json', { headers: FETCH_HEADERS });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !data.metas) return [];

      return data.metas.slice(0, 24).map(m => {
        const searchQuery = encodeURIComponent(`${m.name} ${m.year || ''} official trailer`);
        return {
          id: m.imdb_id,
          imdbId: m.imdb_id,
          title: m.name,
          year: m.year || '',
          rating: m.imdbRating || '--',
          genres: m.genre || [],
          summary: m.description || '',
          poster: m.poster,
          backdrop: m.background || m.poster,
          torrentCount: 1,
          hasHighQuality: true,
          trailerCode: '',
          trailerEmbedUrl: `https://www.youtube.com/embed?listType=search&list=${searchQuery}&autoplay=1&mute=0&controls=0&modestbranding=1&enablejsapi=1&playsinline=1`
        };
      });
    } catch (e) {
      return [];
    }
  }

  /**
   * Fallback Cinemeta Search with YouTube Search Fallback Trailers
   */
  async _searchCinemetaFallback(query) {
    try {
      const res = await fetch(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`, { headers: FETCH_HEADERS });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !data.metas) return [];

      return data.metas.slice(0, 24).map(m => {
        const searchQuery = encodeURIComponent(`${m.name} ${m.year || ''} official trailer`);
        return {
          id: m.imdb_id,
          imdbId: m.imdb_id,
          title: m.name,
          year: m.year || '',
          rating: m.imdbRating || '--',
          genres: m.genre || [],
          summary: m.description || '',
          poster: m.poster,
          backdrop: m.background || m.poster,
          torrentCount: 1,
          hasHighQuality: true,
          trailerCode: '',
          trailerEmbedUrl: `https://www.youtube.com/embed?listType=search&list=${searchQuery}&autoplay=1&mute=0&controls=0&modestbranding=1&enablejsapi=1&playsinline=1`
        };
      });
    } catch (e) {
      return [];
    }
  }
}
