document.addEventListener('DOMContentLoaded', () => {
  // Global Audio Enable/Disable State (Toggleable Anytime)
  let isAudioEnabled = false;

  // Global User Interaction Tracker for Browser Autoplay Policy Compliance
  let hasUserInteracted = false;
  const markUserInteracted = () => {
    hasUserInteracted = true;
  };
  document.addEventListener('click', markUserInteracted, { capture: true });
  document.addEventListener('keydown', markUserInteracted, { capture: true });
  document.addEventListener('pointerdown', markUserInteracted, { capture: true });

  // Global YouTube Player Instances & Hovercard Teardown Helper
  const activeYtPlayers = new Map();

  function clearAllHovercards() {
    activeYtPlayers.forEach((player) => {
      try {
        if (player && typeof player.destroy === 'function') {
          player.destroy();
        }
      } catch (e) {}
    });
    activeYtPlayers.clear();
    document.querySelectorAll('.movie-card').forEach(c => c.classList.remove('is-hovered'));
    document.querySelectorAll('.trailer-hovercard').forEach(el => el.remove());
  }

  // Branding Logo & Navigation Tabs
  const appLogo = document.getElementById('app-logo');
  const btnHome = document.getElementById('btn-home');
  const btnStreamHome = document.getElementById('btn-stream-home');
  const tabMagnet = document.getElementById('tab-magnet');
  const tabDownloads = document.getElementById('tab-downloads');
  const navbarCenterSearch = document.getElementById('navbar-center-search');

  const sectionDiscover = document.getElementById('section-discover');
  const sectionMagnet = document.getElementById('section-magnet');
  const sectionDownloads = document.getElementById('section-downloads');

  // Downloads Manager Elements
  const downloadsGrid = document.getElementById('downloads-grid');
  const storageTotalSize = document.getElementById('storage-total-size');
  const btnClearAllDownloads = document.getElementById('btn-clear-all-downloads');

  // Carousel Elements
  const carouselSection = document.getElementById('featured-carousel-section');
  const carouselTrack = document.getElementById('carousel-track');
  const carouselPrev = document.getElementById('carousel-prev');
  const carouselNext = document.getElementById('carousel-next');
  const carouselDots = document.getElementById('carousel-dots');

  // Catalog & Category Filter Elements
  const movieGrid = document.getElementById('movie-grid');
  const catalogSearchInput = document.getElementById('catalog-search-input');
  const btnCatalogSearch = document.getElementById('btn-catalog-search');
  const catalogTitle = document.getElementById('catalog-title');
  const infiniteLoader = document.getElementById('infinite-scroll-loader');
  const categoryPillsBar = document.getElementById('category-pills-bar');

  // Modal Elements
  const streamModal = document.getElementById('stream-modal');
  const modalClose = document.getElementById('modal-close');
  const modalPoster = document.getElementById('modal-poster');
  const modalTitle = document.getElementById('modal-title');
  const modalYear = document.getElementById('modal-year');
  const modalRating = document.getElementById('modal-rating');
  const modalGenres = document.getElementById('modal-genres');
  const modalSummary = document.getElementById('modal-summary');
  const modalStreamsList = document.getElementById('modal-streams-list');

  // Magnet / Direct Form Elements
  const form = document.getElementById('torrent-form');
  const magnetInput = document.getElementById('magnet-input');
  const btnStream = document.getElementById('btn-stream');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Stream Player Elements
  const streamSection = document.getElementById('stream-section');
  const torrentTitle = document.getElementById('torrent-title');
  const statusPill = document.getElementById('status-pill');

  const videoPlayer = document.getElementById('video-player');
  const subtitleOverlay = document.getElementById('subtitle-overlay');
  const seekIndicator = document.getElementById('seek-indicator');
  const playerOverlay = document.getElementById('player-overlay');
  const overlayText = document.getElementById('overlay-text');

  // Subtitle Controls Elements
  const subLangSelect = document.getElementById('sub-lang-select');
  const subTrackSelect = document.getElementById('sub-track-select');
  const btnUploadSub = document.getElementById('btn-upload-sub');
  const subFileInput = document.getElementById('sub-file-input');

  const subFontSize = document.getElementById('sub-font-size');
  const subFontFamily = document.getElementById('sub-font-family');
  const subBgOpacity = document.getElementById('sub-bg-opacity');
  const subColor = document.getElementById('sub-color');

  const formatWarning = document.getElementById('format-warning');
  const formatNoticeText = document.getElementById('format-notice-text');

  const btnStop = document.getElementById('btn-stop');

  const fileSelectorBox = document.getElementById('file-selector-box');
  const fileSelect = document.getElementById('file-select');

  const statDownloadSpeed = document.getElementById('stat-download-speed');
  const statUploadSpeed = document.getElementById('stat-upload-speed');
  const statPeers = document.getElementById('stat-peers');
  const statTtff = document.getElementById('stat-ttff');

  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const etaText = document.getElementById('eta-text');
  const btnStreamPause = document.getElementById('btn-stream-pause');
  const btnStreamCancel = document.getElementById('btn-stream-cancel');
  const pauseDisclaimer = document.getElementById('pause-disclaimer');
  const securityPill = document.getElementById('security-pill');
  const securityWarning = document.getElementById('security-warning');
  const securityNoticeText = document.getElementById('security-notice-text');

  // State
  let currentInfoHash = null;
  let currentFileIndex = 0;
  let currentImdbId = null;
  let eventSource = null;
  let streamStartTime = null;
  let activeCueList = [];
  let seekTimeout = null;
  let isStreamPaused = false;

  // Infinite Circular Carousel State
  let currentSlideIndex = 0;
  let currentTrackIndex = 1;
  let heroMoviesList = [];
  let autoScrollInterval = null;

  // Infinite Scroll, Date Sorting & Category State
  let currentPage = 1;
  let isLoadingMore = false;
  let hasMoreMovies = true;
  let isSearching = false;
  let currentGenre = 'all';

  // Utility Functions
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec) {
    return formatBytes(bytesPerSec) + '/s';
  }

  function formatTime(seconds) {
    if (!seconds || seconds === Infinity || isNaN(seconds)) return 'Calculating...';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  // Position-Aware Subtle Seek & Keyboard Feedback Animation (Left, Right, Center)
  function showSeekFeedback(text, pos = 'center') {
    if (!seekIndicator) return;
    seekIndicator.textContent = text;
    seekIndicator.className = `seek-indicator pos-${pos}`;

    requestAnimationFrame(() => {
      seekIndicator.classList.add('visible');
    });

    if (seekTimeout) clearTimeout(seekTimeout);
    seekTimeout = setTimeout(() => {
      seekIndicator.classList.remove('visible');
      setTimeout(() => {
        if (!seekIndicator.classList.contains('visible')) {
          seekIndicator.classList.add('hidden');
        }
      }, 250);
    }, 450);
  }

  // Check if any fullscreen mode is active across browsers
  function isFullscreenActive() {
    return !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    );
  }

  function toggleFullscreen() {
    const wrapper = document.querySelector('.player-wrapper') || videoPlayer;

    if (!isFullscreenActive()) {
      if (wrapper.requestFullscreen) {
        wrapper.requestFullscreen();
      } else if (wrapper.webkitRequestFullscreen) {
        wrapper.webkitRequestFullscreen();
      } else if (videoPlayer.requestFullscreen) {
        videoPlayer.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  let isPlayPausePending = false;

  async function togglePlayPause() {
    if (isPlayPausePending) return;
    isPlayPausePending = true;

    try {
      if (videoPlayer.paused) {
        await videoPlayer.play();
        showSeekFeedback('▶ Play', 'center');
      } else {
        videoPlayer.pause();
        showSeekFeedback('⏸ Pause', 'center');
      }
    } catch (err) {
      console.log('Play/Pause toggle note:', err.message);
    } finally {
      isPlayPausePending = false;
    }
  }

  let isSeekingRemux = false;

  function safeSeek(seconds) {
    if (!videoPlayer) return;

    showSeekFeedback(`${seconds > 0 ? '+' : ''}${seconds}s ${seconds > 0 ? '⏩' : '⏪'}`, seconds > 0 ? 'right' : 'left');

    const duration = videoPlayer.duration;
    const isFiniteDuration = Number.isFinite(duration) && duration > 0;
    const targetTime = Math.max(0, (videoPlayer.currentTime || 0) + seconds);

    const isRemuxedStream = !formatWarning.classList.contains('hidden') || !isFiniteDuration || !!currentDiskFolder;

    if (isRemuxedStream) {
      isSeekingRemux = true;
      let baseUrl = null;
      if (currentDiskFolder) {
        baseUrl = `/api/downloads/stream/${encodeURIComponent(currentDiskFolder)}`;
      } else if (currentInfoHash) {
        baseUrl = `/api/stream/${currentInfoHash}/${currentFileIndex}`;
      }

      if (baseUrl) {
        videoPlayer.src = `${baseUrl}?ss=${Math.floor(targetTime)}`;
        videoPlayer.play().catch(() => {});
        setTimeout(() => { isSeekingRemux = false; }, 1000);
        return;
      }
    }

    if (isFiniteDuration) {
      videoPlayer.currentTime = Math.min(duration - 0.5, targetTime);
      return;
    }

    videoPlayer.currentTime = targetTime;
  }

  // Global Keydown Handler for Directional Keys & Shortcuts
  function handleGlobalKeyDown(e) {
    const activeElem = document.activeElement;
    if (activeElem && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElem.tagName)) {
      return;
    }

    const key = e.key.toLowerCase();
    const code = e.code;

    // Toggle Play/Pause on Spacebar or 'k'
    if (code === 'Space' || key === ' ' || key === 'spacebar' || key === 'k') {
      e.preventDefault();
      togglePlayPause();
    } else if (key === 'arrowright' || code === 'ArrowRight') {
      e.preventDefault();
      safeSeek(10);
    } else if (key === 'arrowleft' || code === 'ArrowLeft') {
      e.preventDefault();
      safeSeek(-10);
    } else if (key === 'arrowup' || code === 'ArrowUp') {
      e.preventDefault();
      videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1);
      showSeekFeedback(`🔊 ${Math.round(videoPlayer.volume * 100)}%`, 'center');
    } else if (key === 'arrowdown' || code === 'ArrowDown') {
      e.preventDefault();
      videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1);
      showSeekFeedback(`🔉 ${Math.round(videoPlayer.volume * 100)}%`, 'center');
    } else if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'm') {
      e.preventDefault();
      videoPlayer.muted = !videoPlayer.muted;
      showSeekFeedback(videoPlayer.muted ? '🔇 Muted' : '🔊 Unmuted', 'center');
    }
  }

  // Single Global Keydown Listener
  window.addEventListener('keydown', handleGlobalKeyDown);

  // Sync On-Screen Feedback Overlay with Video Play & Pause Events
  videoPlayer.addEventListener('play', () => {
    showSeekFeedback('▶ Play', 'center');
  });
  videoPlayer.addEventListener('pause', () => {
    showSeekFeedback('⏸ Pause', 'center');
  });

  function stopAndClearPlayer() {
    if (videoPlayer) {
      try {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
      } catch (e) {}
    }
  }

  // Home Button & Logo Click Navigation Logic
  function goHome() {
    btnHome.classList.add('active');
    if (tabDownloads) tabDownloads.classList.remove('active');
    tabMagnet.classList.remove('active');

    if (navbarCenterSearch) navbarCenterSearch.classList.remove('hidden');

    sectionDiscover.classList.remove('hidden');
    sectionMagnet.classList.add('hidden');
    if (sectionDownloads) sectionDownloads.classList.add('hidden');
    streamSection.classList.add('hidden');
    streamModal.classList.add('hidden');

    stopAndClearPlayer();

    catalogSearchInput.value = '';
    currentGenre = 'all';
    updateCategoryPillUI('all');
    loadTrendingCatalog(true, 'all');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (appLogo) appLogo.addEventListener('click', goHome);
  btnHome.addEventListener('click', goHome);
  btnStreamHome.addEventListener('click', goHome);

  // Navigation Tab Switching
  if (tabDownloads) {
    tabDownloads.addEventListener('click', () => {
      tabDownloads.classList.add('active');
      btnHome.classList.remove('active');
      tabMagnet.classList.remove('active');

      if (navbarCenterSearch) navbarCenterSearch.classList.add('hidden');

      if (sectionDownloads) sectionDownloads.classList.remove('hidden');
      sectionDiscover.classList.add('hidden');
      sectionMagnet.classList.add('hidden');
      streamSection.classList.add('hidden');

      stopAndClearPlayer();

      loadDownloadedStorage();
    });
  }

  tabMagnet.addEventListener('click', () => {
    tabMagnet.classList.add('active');
    btnHome.classList.remove('active');
    if (tabDownloads) tabDownloads.classList.remove('active');

    if (navbarCenterSearch) navbarCenterSearch.classList.add('hidden');

    sectionMagnet.classList.remove('hidden');
    sectionDiscover.classList.add('hidden');
    if (sectionDownloads) sectionDownloads.classList.add('hidden');
    streamSection.classList.add('hidden');

    stopAndClearPlayer();
  });

  // Category Pill Event Listeners
  if (categoryPillsBar) {
    const pills = categoryPillsBar.querySelectorAll('.category-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        const genre = pill.dataset.genre || 'all';
        currentGenre = genre;
        updateCategoryPillUI(genre);
        catalogSearchInput.value = '';
        loadTrendingCatalog(true, genre);
      });
    });
  }

  function updateCategoryPillUI(activeGenre) {
    if (!categoryPillsBar) return;
    const pills = categoryPillsBar.querySelectorAll('.category-pill');
    pills.forEach(pill => {
      if (pill.dataset.genre === activeGenre) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
  }

  // CATALOG LOGIC & HERO CAROUSEL
  async function loadTrendingCatalog(reset = true, genre = currentGenre) {
    if (reset) {
      currentPage = 1;
      hasMoreMovies = true;
      isSearching = false;

      // Show Carousel on Home / Discover view
      if (carouselSection) carouselSection.classList.remove('hidden');

      const genreLabel = (genre && genre !== 'all') ? `${genre.toUpperCase()} Movies` : 'Movies For You';
      catalogTitle.innerHTML = `<i class="fa-solid fa-fire"></i> ${genreLabel}`;

      movieGrid.innerHTML = `
        <div class="grid-loading">
          <i class="fa-solid fa-spinner fa-spin spinner"></i>
          <span>Fetching Recommendations...</span>
        </div>
      `;
    }

    try {
      const genreParam = (genre && genre !== 'all') ? `&genre=${encodeURIComponent(genre)}` : '';
      const res = await fetch(`/api/catalog/trending?page=${currentPage}&limit=24${genreParam}`);
      const data = await res.json();

      if (data.success && data.movies && data.movies.length > 0) {
        if (reset) {
          movieGrid.innerHTML = '';
          renderFeaturedHeroCarousel(data.movies.slice(0, 10));
        }
        appendMovieCards(data.movies);
      } else {
        if (reset) {
          movieGrid.innerHTML = `<div class="grid-loading"><span>No movies found for this category.</span></div>`;
        }
        hasMoreMovies = false;
      }
    } catch (err) {
      if (reset) {
        movieGrid.innerHTML = `<div class="grid-loading"><span>Failed to load movies. Check connection.</span></div>`;
      }
    }
  }

  // Infinite Scroll Listener
  window.addEventListener('scroll', () => {
    if (sectionDiscover.classList.contains('hidden') || isSearching || isLoadingMore || !hasMoreMovies) return;

    const scrollPosition = window.innerHeight + window.scrollY;
    const threshold = document.documentElement.scrollHeight - 700;

    if (scrollPosition >= threshold) {
      loadMoreTrendingMovies();
    }
  });

  async function loadMoreTrendingMovies() {
    if (isLoadingMore || !hasMoreMovies || isSearching) return;
    isLoadingMore = true;

    if (infiniteLoader) infiniteLoader.classList.add('hidden');

    currentPage++;
    try {
      const genreParam = (currentGenre && currentGenre !== 'all') ? `&genre=${encodeURIComponent(currentGenre)}` : '';
      const res = await fetch(`/api/catalog/trending?page=${currentPage}&limit=24${genreParam}`);
      const data = await res.json();

      if (data.success && data.movies && data.movies.length > 0) {
        appendMovieCards(data.movies);
      } else {
        hasMoreMovies = false;
      }
    } catch (err) {
      console.warn('Infinite scroll error:', err);
    } finally {
      isLoadingMore = false;
      if (infiniteLoader) infiniteLoader.classList.add('hidden');
    }
  }

  // Helper to create a Hero Carousel Slide Node
  function createSlideNode(movie) {
    const slide = document.createElement('div');
    slide.className = 'hero-slide';

    const hqBadge = movie.hasHighQuality 
      ? `<span class="badge-hq-hero"><i class="fa-solid fa-sparkles"></i> High Quality Available</span>` 
      : ``;

    slide.innerHTML = `
      <img class="hero-backdrop-img" src="${movie.backdrop || movie.poster}" alt="${movie.title}" />
      <div class="hero-gradient-overlay"></div>
      <div class="hero-slide-inner">
        <div class="hero-poster-box">
          <img class="hero-poster-img" src="${movie.poster || movie.backdrop}" alt="${movie.title}" loading="eager" />
        </div>
        <div class="hero-content">
          <div class="hero-badges">
            ${hqBadge}
            <span class="badge-tag">${movie.year || '2024'}</span>
            ${(movie.rating && movie.rating !== '0' && movie.rating !== '--' && movie.rating !== 'NR') ? `<span class="badge-tag badge-star"><i class="fa-solid fa-star"></i> ${movie.rating}</span>` : ''}
            <span class="badge-genres">${(movie.genres && movie.genres.join(', ')) || 'Featured'}</span>
          </div>
          <h2 class="hero-title">${movie.title}</h2>
          <p class="hero-summary">${movie.summary || 'Experience this feature film in full High Quality 4K resolution with multi-language subtitles.'}</p>
          <button class="btn-hero-play">
            <i class="fa-solid fa-play"></i> Play
          </button>
        </div>
      </div>
    `;

    slide.querySelector('.btn-hero-play').addEventListener('click', () => openMovieStreamsModal(movie));
    return slide;
  }

  let isCarouselMoving = false;

  // Render Infinite Circular Hero Banner Carousel via Hardware-Accelerated CSS Transform
  function renderFeaturedHeroCarousel(movies) {
    if (!carouselTrack || !movies || movies.length === 0) return;
    heroMoviesList = movies;
    const N = heroMoviesList.length;

    currentTrackIndex = 1;
    currentSlideIndex = 0;
    isCarouselMoving = false;

    carouselTrack.innerHTML = '';
    carouselDots.innerHTML = '';

    // 1. Prepend Clone of Last Movie (index N-1) for smooth backwards loop
    const cloneLast = createSlideNode(heroMoviesList[N - 1]);
    carouselTrack.appendChild(cloneLast);

    // 2. Append All Real Movies & Create Navigation Dots
    heroMoviesList.forEach((movie, index) => {
      const slide = createSlideNode(movie);
      carouselTrack.appendChild(slide);

      const dot = document.createElement('div');
      dot.className = `hero-dot ${index === 0 ? 'active' : ''}`;
      dot.addEventListener('click', () => goToSlide(index));
      carouselDots.appendChild(dot);
    });

    // 3. Append Clone of First Movie (index 0) for smooth forwards loop
    const cloneFirst = createSlideNode(heroMoviesList[0]);
    carouselTrack.appendChild(cloneFirst);

    // Position track to real 1st movie (trackIndex = 1) instantly via CSS transform
    carouselTrack.style.transition = 'none';
    carouselTrack.style.transform = `translateX(-100%)`;
    carouselTrack.offsetHeight; // Force reflow

    startHeroAutoScroll();
  }

  function goToSlide(targetArg) {
    if (!carouselTrack || heroMoviesList.length === 0 || isCarouselMoving) return;
    const N = heroMoviesList.length;

    let targetTrackIndex;

    if (targetArg === 'next') {
      targetTrackIndex = currentTrackIndex + 1;
    } else if (targetArg === 'prev') {
      targetTrackIndex = currentTrackIndex - 1;
    } else {
      targetTrackIndex = targetArg + 1;
    }

    isCarouselMoving = true;
    currentTrackIndex = targetTrackIndex;

    // Smooth forward/backward sliding via hardware-accelerated transform
    carouselTrack.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
    carouselTrack.style.transform = `translateX(-${targetTrackIndex * 100}%)`;

    // Calculate real index for navigation dots
    let realIndex = (targetTrackIndex - 1 + N) % N;
    currentSlideIndex = realIndex;

    // Update Dots
    const dots = carouselDots.querySelectorAll('.hero-dot');
    dots.forEach((d, idx) => {
      if (idx === realIndex) d.classList.add('active');
      else d.classList.remove('active');
    });

    // Seamless Infinite Loop Reset at transition completion
    setTimeout(() => {
      if (!carouselTrack) return;
      if (targetTrackIndex === N + 1) {
        // Reached Clone(0), instantly snap back to real Movie 0 (trackIndex = 1) without animation!
        carouselTrack.style.transition = 'none';
        carouselTrack.style.transform = `translateX(-100%)`;
        carouselTrack.offsetHeight; // Force DOM reflow
        currentTrackIndex = 1;
      } else if (targetTrackIndex === 0) {
        // Reached Clone(N-1), instantly snap to real Movie N-1 (trackIndex = N) without animation!
        carouselTrack.style.transition = 'none';
        carouselTrack.style.transform = `translateX(-${N * 100}%)`;
        carouselTrack.offsetHeight; // Force DOM reflow
        currentTrackIndex = N;
      }
      isCarouselMoving = false;
    }, 610);
  }

  // Smooth Infinite Circular Auto-Scrolling (Every 4 seconds)
  function startHeroAutoScroll() {
    stopHeroAutoScroll();
    autoScrollInterval = setInterval(() => {
      goToSlide('next');
    }, 4000);
  }

  function stopHeroAutoScroll() {
    if (autoScrollInterval) clearInterval(autoScrollInterval);
  }

  if (carouselTrack) {
    carouselTrack.addEventListener('mouseenter', stopHeroAutoScroll);
    carouselTrack.addEventListener('mouseleave', startHeroAutoScroll);
  }

  if (carouselPrev) {
    carouselPrev.addEventListener('click', () => {
      stopHeroAutoScroll();
      goToSlide('prev');
      startHeroAutoScroll();
    });
  }

  if (carouselNext) {
    carouselNext.addEventListener('click', () => {
      stopHeroAutoScroll();
      goToSlide('next');
      startHeroAutoScroll();
    });
  }

  function appendMovieCards(movies) {
    movies.forEach((movie) => {
      const card = document.createElement('div');
      card.className = 'movie-card';
      const cardHqBadge = movie.hasHighQuality
        ? `<div class="card-hq-badge"><i class="fa-solid fa-sparkles"></i> High Quality</div>`
        : ``;

      card.innerHTML = `
        <div class="poster-wrapper">
          <img class="poster-img" src="${movie.poster || 'https://via.placeholder.com/300x450?text=No+Poster'}" alt="${movie.title}" loading="lazy" />
          ${cardHqBadge}
          ${(movie.rating && movie.rating !== '0' && movie.rating !== '--' && movie.rating !== 'NR') ? `<div class="rating-badge"><i class="fa-solid fa-star"></i> ${movie.rating}</div>` : ''}
        </div>
        <div class="movie-card-info">
          <div class="movie-card-title">${movie.title}</div>
          <div class="movie-card-meta">
            <span>${movie.year || ''}</span>
            <span>${(movie.genres && movie.genres[0]) || ''}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => openMovieStreamsModal(movie));

      // 40ms 3D Elevated Big Card Overlay Engine with Viewport Edge Containment
      let hoverTimer = null;

      card.addEventListener('mouseenter', () => {
        if (hoverTimer) clearTimeout(hoverTimer);

        // 40ms Hover Delay Threshold
        hoverTimer = setTimeout(() => {
          // Instantly destroy any active hovercards playing on OTHER cards
          clearAllHovercards();

          // Elevate current card's parent stacking context above ALL other cards
          card.classList.add('is-hovered');

          const ytCode = movie.trailerCode || '';
          const playerId = `yt-player-${movie.id}-${Date.now()}`;

          // Calculate viewport edge containment
          const rect = card.getBoundingClientRect();
          const isLeftEdge = rect.left < 60;
          const isRightEdge = (window.innerWidth - rect.right) < 60;

          // Create Elevated Pop-Out Big Card Overlay
          const hovercard = document.createElement('div');
          hovercard.className = 'trailer-hovercard';

          if (isLeftEdge) {
            hovercard.classList.add('edge-left');
          } else if (isRightEdge) {
            hovercard.classList.add('edge-right');
          }

          const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(movie.title + ' ' + (movie.year || '') + ' official trailer')}`;
          hovercard.innerHTML = `
            <div class="hovercard-video-box">
              <div id="${playerId}" class="trailer-iframe"></div>
              <button class="trailer-sound-toggle" title="${isAudioEnabled ? 'Disable Sound' : 'Enable Sound'}">
                <i class="fa-solid ${isAudioEnabled ? 'fa-volume-high' : 'fa-volume-xmark'}"></i>
              </button>
            </div>
            <div class="hovercard-footer-info">
              <div class="hovercard-title-row">
                <div class="hovercard-title">${movie.title}</div>
                ${(movie.rating && movie.rating !== '0' && movie.rating !== '--' && movie.rating !== 'NR') ? `<div class="hovercard-rating"><i class="fa-solid fa-star"></i> ${movie.rating}</div>` : ''}
              </div>
              <div class="hovercard-meta">
                <span>${movie.year || ''}</span> &bull; <span>${(movie.genres && movie.genres.join(', ')) || 'Featured'}</span>
              </div>
              <button class="btn-hovercard-stream">
                <i class="fa-solid fa-play"></i> Play
              </button>
            </div>
          `;

          card.appendChild(hovercard);

          // Stream Selection Button Click Handler
          const btnStreamNow = hovercard.querySelector('.btn-hovercard-stream');
          if (btnStreamNow) {
            btnStreamNow.addEventListener('click', (e) => {
              e.stopPropagation();
              clearAllHovercards();
              openMovieStreamsModal(movie);
            });
          }

          function showCommunicativeTrailerCard(targetBox) {
            if (!targetBox) return;
            targetBox.innerHTML = `
              <div class="trailer-notice-card" style="background-image: url('${movie.backdrop || movie.poster}');">
                <div class="notice-card-overlay">
                  <div class="notice-badge-icon"><i class="fa-brands fa-youtube"></i></div>
                  <div class="notice-card-text">
                    <strong>Official Trailer Available</strong>
                    <span>Playback restricted on embedded players</span>
                  </div>
                  <a href="${ytSearchUrl}" target="_blank" class="btn-notice-yt" onclick="event.stopPropagation();">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> Watch on YouTube
                  </a>
                </div>
              </div>
            `;
          }

          let ytPlayerInstance = null;

          // Primary: If specific YouTube Video Code exists and YT.Player API is ready, use YT.Player
          if (ytCode && window.YT && window.YT.Player) {
            try {
              ytPlayerInstance = new YT.Player(playerId, {
                videoId: ytCode,
                playerVars: {
                  autoplay: 1,
                  mute: isAudioEnabled ? 0 : 1,
                  controls: 0,
                  modestbranding: 1,
                  loop: 1,
                  playlist: ytCode,
                  playsinline: 1,
                  rel: 0
                },
                events: {
                  onReady: (evt) => {
                    if (isAudioEnabled) {
                      evt.target.unMute();
                      evt.target.setVolume(100);
                    } else {
                      evt.target.mute();
                    }
                    evt.target.playVideo();
                  },
                  onError: () => {
                    const videoBox = hovercard.querySelector('.hovercard-video-box');
                    showCommunicativeTrailerCard(videoBox);
                  }
                }
              });
              activeYtPlayers.set(playerId, ytPlayerInstance);
            } catch (err) {
              console.warn('YT.Player instantiation error:', err);
            }
          }

          // Fallback: If no ytCode, show Communicative Trailer Card directly instead of broken "Video Unavailable" iframe!
          if (!ytCode) {
            const videoBox = hovercard.querySelector('.hovercard-video-box');
            showCommunicativeTrailerCard(videoBox);
          }

          // Sound Toggle Button Handler
          const soundBtn = hovercard.querySelector('.trailer-sound-toggle');
          if (soundBtn) {
            soundBtn.addEventListener('click', (e) => {
              e.stopPropagation(); // Prevents opening stream selection modal
              isAudioEnabled = !isAudioEnabled;
              hasUserInteracted = true;

              if (isAudioEnabled) {
                soundBtn.innerHTML = `<i class="fa-solid fa-volume-high"></i>`;
                soundBtn.title = "Disable Sound";
                soundBtn.style.background = '#f59e0b';
                soundBtn.style.color = '#000';

                if (ytPlayerInstance && typeof ytPlayerInstance.unMute === 'function') {
                  ytPlayerInstance.unMute();
                  ytPlayerInstance.setVolume(100);
                } else {
                  const iframe = hovercard.querySelector('iframe');
                  if (iframe) {
                    iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":[]}', '*');
                    iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[100]}', '*');
                  }
                }
              } else {
                soundBtn.innerHTML = `<i class="fa-solid fa-volume-xmark"></i>`;
                soundBtn.title = "Enable Sound";
                soundBtn.style.background = 'rgba(11, 15, 25, 0.92)';
                soundBtn.style.color = '#f59e0b';

                if (ytPlayerInstance && typeof ytPlayerInstance.mute === 'function') {
                  ytPlayerInstance.mute();
                } else {
                  const iframe = hovercard.querySelector('iframe');
                  if (iframe) {
                    iframe.contentWindow.postMessage('{"event":"command","func":"mute","args":[]}', '*');
                  }
                }
              }
            });
          }
        }, 40); // 40ms hover delay
      });

      card.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }
        // Immediately destroy YT.Player and remove hovercard
        clearAllHovercards();
      });

      movieGrid.appendChild(card);
    });
  }

  // Catalog Search
  btnCatalogSearch.addEventListener('click', performCatalogSearch);
  catalogSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performCatalogSearch();
  });

  catalogSearchInput.addEventListener('input', (e) => {
    if (!e.target.value.trim() && isSearching) {
      isSearching = false;
      catalogTitle.innerHTML = `<i class="fa-solid fa-fire"></i> Movies For You`;
      loadTrendingCatalog(true, currentGenre);
    }
  });

  async function performCatalogSearch() {
    const q = catalogSearchInput.value.trim();
    if (!q) {
      isSearching = false;
      catalogTitle.innerHTML = `<i class="fa-solid fa-fire"></i> Movies For You`;
      return loadTrendingCatalog(true, currentGenre);
    }

    isSearching = true;
    stopHeroAutoScroll();

    // Hide Big Featured Carousel during search results view
    if (carouselSection) carouselSection.classList.add('hidden');

    catalogTitle.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search Results for "${q}"`;
    movieGrid.innerHTML = `
      <div class="grid-loading">
        <i class="fa-solid fa-spinner fa-spin spinner"></i>
        <span>Searching for "${q}"...</span>
      </div>
    `;

    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success && data.movies && data.movies.length > 0) {
        movieGrid.innerHTML = '';
        appendMovieCards(data.movies);
      } else {
        movieGrid.innerHTML = `<div class="grid-loading"><span>No movies found for "${q}".</span></div>`;
      }
    } catch (err) {
      movieGrid.innerHTML = `<div class="grid-loading"><span>Search failed: ${err.message}</span></div>`;
    }
  }

  // Open Streams Modal
  async function openMovieStreamsModal(movie) {
    // Destroy any playing hovercards when opening stream modal
    clearAllHovercards();

    currentImdbId = movie.imdbId;
    modalPoster.src = movie.poster || '';
    modalTitle.textContent = movie.title;
    modalYear.textContent = movie.year || '';
    if (movie.rating && movie.rating !== '0' && movie.rating !== '--' && movie.rating !== 'NR') {
      modalRating.innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating}`;
      modalRating.style.display = 'inline-flex';
    } else {
      modalRating.style.display = 'none';
    }
    modalGenres.textContent = movie.genres ? movie.genres.join(', ') : '';
    modalSummary.textContent = movie.summary || 'No overview available.';
    modalStreamsList.innerHTML = `<div class="spinner-box"><i class="fa-solid fa-circle-notch fa-spin"></i> Finding HD Streams & Seeds...</div>`;
    
    streamModal.classList.remove('hidden');

    try {
      const res = await fetch(`/api/catalog/streams?imdbId=${movie.imdbId}&id=${movie.id}&title=${encodeURIComponent(movie.title)}`);
      const data = await res.json();

      if (data.success && data.streams) {
        renderStreamsList(data.streams, movie);
      } else {
        renderStreamsList([], movie);
      }
    } catch (err) {
      renderStreamsList([], movie);
    }
  }

  function renderStreamsList(streams, movie) {
    modalStreamsList.innerHTML = '';

    // Inline Custom Magnet Paste Box
    const customInputCard = document.createElement('div');
    customInputCard.className = 'custom-magnet-box';
    customInputCard.innerHTML = `
      <div class="custom-magnet-title">
        <i class="fa-solid fa-link"></i> Have a custom magnet or torrent link for <strong>${movie ? movie.title : 'this movie'}</strong>?
      </div>
      <div class="custom-magnet-input-row">
        <input type="text" id="modal-custom-magnet-input" placeholder="Paste magnet:?xt=urn:btih:... link here..." autocomplete="off" />
        <button id="btn-modal-play-custom" class="btn btn-primary">
          <i class="fa-solid fa-play"></i> Play Link
        </button>
      </div>
    `;

    modalStreamsList.appendChild(customInputCard);

    const btnModalCustomPlay = customInputCard.querySelector('#btn-modal-play-custom');
    const modalCustomInput = customInputCard.querySelector('#modal-custom-magnet-input');

    if (btnModalCustomPlay && modalCustomInput) {
      btnModalCustomPlay.addEventListener('click', async () => {
        const magnet = modalCustomInput.value.trim();
        if (!magnet) {
          alert('Please paste a valid magnet link');
          return;
        }
        streamModal.classList.add('hidden');
        await startTorrent({ magnet }, false);
      });
    }

    if (streams && streams.length > 0) {
      streams.forEach((st) => {
        const optionCard = document.createElement('div');
        optionCard.className = 'stream-option-card';
        const isHighQuality = st.quality.includes('2160p') || st.quality.includes('4K') || 
                                 (st.codec && (st.codec.includes('x265') || st.codec.includes('hevc')));

        optionCard.innerHTML = `
          <div class="stream-info-main">
            <div class="stream-title-text">
              <span class="stream-badge-quality">${st.quality}</span> ${st.type ? st.type.toUpperCase() : ''} (${st.codec}) &bull; ${st.sizeFormatted}
              ${isHighQuality ? '<span class="badge-hq-auto"><i class="fa-solid fa-sparkles"></i> High Quality</span>' : ''}
            </div>
            <div class="stream-sub-text">${st.title}</div>
          </div>
          <div class="stream-seeders">
            <i class="fa-solid fa-users"></i> ${st.seeds} seeders
          </div>
        `;

        optionCard.addEventListener('click', async () => {
          streamModal.classList.add('hidden');
          const torrentData = await startTorrent({ magnet: st.magnetUrl }, false);

          if (torrentData && torrentData.torrent && torrentData.torrent.selectedFile && !torrentData.torrent.selectedFile.isWebPlayable) {
            formatWarning.classList.remove('hidden');
            formatNoticeText.textContent = `High Quality (${st.quality} ${st.codec}) container detected. Format will be remuxed on the fly for web playback.`;
          }

          const subQuery = currentImdbId || currentMovieTitle || (movie ? movie.title : null);
          if (subQuery) {
            fetchSubtitlesForMovie(subQuery, subLangSelect.value);
          }
        });

        modalStreamsList.appendChild(optionCard);
      });
    } else {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'banner banner-info';
      emptyNotice.innerHTML = `<i class="fa-solid fa-info-circle"></i> No automatic streams found on YTS. Paste your magnet link above to stream <strong>${movie ? movie.title : 'this movie'}</strong> instantly!`;
      modalStreamsList.appendChild(emptyNotice);
    }
  }

  modalClose.addEventListener('click', () => streamModal.classList.add('hidden'));
  streamModal.addEventListener('click', (e) => {
    if (e.target === streamModal) streamModal.classList.add('hidden');
  });

  // Load trending catalog & hero carousel on startup
  loadTrendingCatalog(true, 'all');

  // SUBTITLE ENGINE LOGIC & CUSTOM STYLING
  subLangSelect.addEventListener('change', () => {
    const query = currentImdbId || currentMovieTitle || (torrentTitle.textContent !== 'BitTorrent Stream' ? torrentTitle.textContent : null);
    if (query) {
      fetchSubtitlesForMovie(query, subLangSelect.value);
    }
  });

  async function fetchSubtitlesForMovie(query, lang) {
    if (!query) return;
    const langName = subLangSelect.options[subLangSelect.selectedIndex]?.text || lang.toUpperCase();
    subTrackSelect.innerHTML = `<option value="off">Off (Searching ${langName} Subtitles...)</option>`;
    
    try {
      const isImdb = query.startsWith('tt') || /^\d+$/.test(query);
      const paramName = isImdb ? 'imdbId' : 'title';
      const res = await fetch(`/api/subtitles/search?${paramName}=${encodeURIComponent(query)}&lang=${lang}`);
      const data = await res.json();

      subTrackSelect.innerHTML = `<option value="off">Off (No Subtitles Found)</option>`;
      if (data.success && data.subtitles && data.subtitles.length > 0) {
        subTrackSelect.innerHTML = `<option value="off">Off (No Subtitles)</option>`;
        data.subtitles.forEach((sub) => {
          const opt = document.createElement('option');
          opt.value = `/api/subtitles/track/${sub.id}?url=${encodeURIComponent(sub.downloadUrl)}`;
          opt.textContent = `${sub.langName.toUpperCase()} - ${sub.fileName}`;
          subTrackSelect.appendChild(opt);
        });
        subTrackSelect.selectedIndex = 1;
        loadSelectedSubtitleTrack(subTrackSelect.value);
      }
    } catch (err) {
      console.warn('Subtitle fetch error:', err);
      subTrackSelect.innerHTML = `<option value="off">Off (No Subtitles Found)</option>`;
    }
  }

  subTrackSelect.addEventListener('change', (e) => {
    loadSelectedSubtitleTrack(e.target.value);
  });

  function loadSelectedSubtitleTrack(trackUrl) {
    Array.from(videoPlayer.querySelectorAll('track')).forEach(t => t.remove());
    if (videoPlayer.textTracks) {
      for (let i = 0; i < videoPlayer.textTracks.length; i++) {
        videoPlayer.textTracks[i].mode = 'disabled';
      }
    }

    subtitleOverlay.innerHTML = '';
    activeCueList = [];

    if (trackUrl === 'off') return;

    fetch(trackUrl)
      .then(res => res.text())
      .then(vttText => {
        activeCueList = parseVttCues(vttText);
        updateSubtitleOverlay();
      })
      .catch(err => console.error('Failed to load subtitle track:', err));
  }

  // Handle Local .SRT / .VTT Upload
  btnUploadSub.addEventListener('click', () => subFileInput.click());
  subFileInput.addEventListener('change', async (e) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const srtText = evt.target.result;
      const res = await fetch('/api/subtitles/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: srtText
      });
      const data = await res.json();
      if (data.success) {
        const trackUrl = `/api/subtitles/track/${data.subId}`;
        const opt = document.createElement('option');
        opt.value = trackUrl;
        opt.textContent = `UPLOADED - ${file.name}`;
        subTrackSelect.appendChild(opt);
        subTrackSelect.value = trackUrl;
        loadSelectedSubtitleTrack(trackUrl);
      }
    };
    reader.readAsText(file);
  });

  // Custom Subtitle Styling Controls
  function applySubtitleStyles() {
    const size = subFontSize.value;
    const family = subFontFamily.value;
    const bgOpacity = subBgOpacity.value;
    const color = subColor.value;

    document.documentElement.style.setProperty('--sub-font-size', size);
    document.documentElement.style.setProperty('--sub-font-family', family);
    document.documentElement.style.setProperty('--sub-bg-opacity', bgOpacity);
    document.documentElement.style.setProperty('--sub-color', color);
  }

  subFontSize.addEventListener('change', applySubtitleStyles);
  subFontFamily.addEventListener('change', applySubtitleStyles);
  subBgOpacity.addEventListener('change', applySubtitleStyles);
  subColor.addEventListener('change', applySubtitleStyles);
  applySubtitleStyles();

  // Single Source of Truth Subtitle Overlay Renderer
  function updateSubtitleOverlay() {
    if (!activeCueList || activeCueList.length === 0) {
      subtitleOverlay.innerHTML = '';
      return;
    }
    const currentTime = videoPlayer.currentTime;
    const activeCue = activeCueList.find(c => currentTime >= c.start && currentTime <= c.end);

    if (activeCue) {
      subtitleOverlay.innerHTML = `<div class="subtitle-cue-box">${activeCue.text}</div>`;
    } else {
      subtitleOverlay.innerHTML = '';
    }
  }

  videoPlayer.addEventListener('timeupdate', updateSubtitleOverlay);

  function parseVttCues(vttText) {
    const cues = [];
    const blocks = vttText.split(/\n\s*\n/);
    blocks.forEach(block => {
      const lines = block.trim().split('\n');
      let timeLineIdx = lines.findIndex(l => l.includes('-->'));
      if (timeLineIdx !== -1) {
        const timeLine = lines[timeLineIdx];
        const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
        const start = parseVttTimestamp(startStr);
        const end = parseVttTimestamp(endStr);
        const text = lines.slice(timeLineIdx + 1).join('<br>');
        if (!isNaN(start) && !isNaN(end) && text) {
          cues.push({ start, end, text });
        }
      }
    });
    return cues;
  }

  function parseVttTimestamp(str) {
    const parts = str.split(':');
    if (parts.length === 3) {
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2].replace(',', '.'));
      return hrs * 3600 + mins * 60 + secs;
    } else if (parts.length === 2) {
      const mins = parseFloat(parts[0]);
      const secs = parseFloat(parts[1].replace(',', '.'));
      return mins * 60 + secs;
    }
    return NaN;
  }

  // Handle Drag & Drop / File Upload
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  });

  function handleFileUpload(file) {
    if (!file.name.endsWith('.torrent')) {
      alert('Please upload a valid .torrent file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      startTorrent(e.target.result, true);
    };
    reader.readAsArrayBuffer(file);
  }

  // Handle Magnet Link Form Submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const magnet = magnetInput.value.trim();
    if (!magnet) return;
    startTorrent({ magnet }, false);
  });

  /**
   * Start Torrent Processing & Instantly Navigate Directly to Player View
   */
  async function startTorrent(payload, isBinary = false) {
    currentDiskFolder = null;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    // Instantly hide catalog / magnet views and present player dashboard directly
    sectionDiscover.classList.add('hidden');
    sectionMagnet.classList.add('hidden');
    if (sectionDownloads) sectionDownloads.classList.add('hidden');
    if (navbarCenterSearch) navbarCenterSearch.classList.add('hidden');
    streamSection.classList.remove('hidden');

    const statsGrid = document.querySelector('.stats-grid');
    const progressBox = document.querySelector('.progress-box');
    if (statsGrid) statsGrid.classList.remove('hidden');
    if (progressBox) progressBox.classList.remove('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    playerOverlay.classList.remove('hidden');
    overlayText.textContent = 'Connecting to P2P Swarm & resolving metadata...';
    btnStream.disabled = true;
    streamStartTime = Date.now();
    statTtff.textContent = '--';

    try {
      let response;
      if (isBinary) {
        response = await fetch('/api/torrent/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-bittorrent' },
          body: payload
        });
      } else {
        response = await fetch('/api/torrent/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      let data = {};
      if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
        try {
          data = JSON.parse(rawText);
        } catch (e) {
          throw new Error('Invalid JSON response received from server');
        }
      } else {
        if (!response.ok) {
          throw new Error(`Server error (${response.status})`);
        }
      }
      btnStream.disabled = false;

      if (!response.ok || !data || data.error) {
        throw new Error((data && data.error) || 'Failed to add torrent');
      }

      const torrent = data.torrent;
      currentInfoHash = torrent.infoHash;
      currentFileIndex = torrent.selectedFileIndex || 0;

      torrentTitle.textContent = torrent.name || 'BitTorrent Stream';
      
      if (torrent.files && torrent.files.length > 1) {
        const videoFiles = torrent.files.filter(f => f.isVideo);
        if (videoFiles.length > 1) {
          fileSelectorBox.classList.remove('hidden');
          fileSelect.innerHTML = '';
          videoFiles.forEach((f) => {
            const opt = document.createElement('option');
            opt.value = f.index;
            opt.textContent = `${f.name} (${formatBytes(f.length)})`;
            if (f.index === currentFileIndex) opt.selected = true;
            fileSelect.appendChild(opt);
          });
        } else {
          fileSelectorBox.classList.add('hidden');
        }
      } else {
        fileSelectorBox.classList.add('hidden');
      }

  function isHighResolutionVideo(file, torrentName = '') {
    const name = ((file ? file.name : '') + ' ' + torrentName).toLowerCase();
    const length = (file ? file.length : 0);

    const isHighResKeyword = ['4k', '2160p', 'uhd', '1080p', 'fhd', '10bit', 'hdr', 'dv', 'x265', 'hevc', 'h.265', 'ddp', 'atmos', 'eac3', 'truehd', 'dts', '.mkv', '.avi'].some(k => name.includes(k));
    const isLargeFile = length > 1.2 * 1024 * 1024 * 1024; // > 1.2 GB

    return isHighResKeyword || isLargeFile;
  }

      const activeFile = torrent.selectedFile || (torrent.files ? torrent.files[currentFileIndex] : null);
      const isHighRes = isHighResolutionVideo(activeFile, torrent.name);

      if (activeFile && !activeFile.isWebPlayable) {
        formatWarning.classList.remove('hidden');
        formatNoticeText.textContent = `Non-web container video detected. Live web remuxing active.`;
      } else {
        formatWarning.classList.add('hidden');
      }

      bindVideoStream(currentInfoHash, currentFileIndex);
      connectTelemetry(currentInfoHash);

      return data;

    } catch (err) {
      btnStream.disabled = false;
      overlayText.textContent = `Error: ${err.message}`;
      statusPill.className = 'pill pill-danger';
      statusPill.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Failed`;
      console.error(err);
      return null;
    }
  }

  let isVideoStreamLoaded = false;
  let videoRetryTimer = null;

  function bindVideoStream(infoHash, fileIndex) {
    if (videoRetryTimer) clearTimeout(videoRetryTimer);
    isVideoStreamLoaded = false;

    const streamUrl = `/api/stream/${infoHash}/${fileIndex}`;
    videoPlayer.src = streamUrl;
    videoPlayer.load();

    const hideOverlay = () => {
      isVideoStreamLoaded = true;
      if (videoRetryTimer) clearTimeout(videoRetryTimer);
      playerOverlay.classList.add('hidden');
      if (streamStartTime && statTtff.textContent === '--') {
        const ttff = ((Date.now() - streamStartTime) / 1000).toFixed(2);
        statTtff.textContent = `${ttff}s`;
      }
    };

    videoPlayer.oncanplay = () => {
      hideOverlay();
      if (videoPlayer.paused && !videoPlayer.ended) {
        videoPlayer.play().catch(e => console.log('Autoplay note:', e));
      }
    };

    videoPlayer.onloadeddata = hideOverlay;
    videoPlayer.onplaying = hideOverlay;
    videoPlayer.ontimeupdate = () => {
      if (videoPlayer.currentTime > 0) hideOverlay();
    };

    videoPlayer.onerror = (e) => {
      console.log('[Player Notice] HTML5 video element waiting for initial stream chunks...');
    };
  }

  function connectTelemetry(infoHash) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/torrent/events/${infoHash}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) {
        eventSource.close();
        return;
      }

      statDownloadSpeed.textContent = formatSpeed(data.downloadSpeed || 0);
      statUploadSpeed.textContent = formatSpeed(data.uploadSpeed || 0);
      statPeers.textContent = (typeof data.numPeers === 'number') ? data.numPeers : 0;
      if (data.ttff) statTtff.textContent = `${data.ttff}s`;

      if (data.name && data.name !== 'Resolving Metadata...' && torrentTitle.textContent !== data.name) {
        torrentTitle.textContent = data.name;
      }

      if (data.files && data.files.length > 0 && fileSelect.children.length === 0) {
        if (data.files.length > 1) {
          fileSelectorBox.classList.remove('hidden');
          fileSelect.innerHTML = '';
          data.files.forEach((f) => {
            const opt = document.createElement('option');
            opt.value = f.index;
            opt.textContent = `${f.name} (${formatBytes(f.length)})`;
            if (f.index === (data.selectedFileIndex || 0)) opt.selected = true;
            fileSelect.appendChild(opt);
          });
        }
      }

      if (data.security) {
        if (securityPill) {
          if (data.security.threatLevel === 'DANGEROUS') {
            securityPill.className = 'pill pill-danger';
            securityPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Threat Blocked`;
          } else if (data.security.threatLevel === 'SUSPICIOUS') {
            securityPill.className = 'pill pill-warning';
            securityPill.innerHTML = `<i class="fa-solid fa-shield"></i> Security Alert`;
          } else {
            securityPill.className = 'pill pill-success';
            securityPill.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Security Verified`;
          }
        }

        if (securityWarning && securityNoticeText) {
          if (data.security.blockedFilesCount > 0) {
            securityWarning.classList.remove('hidden');
            securityNoticeText.textContent = `Security Guard active: ${data.security.blockedFilesCount} non-media/executable file(s) blocked from P2P download.`;
          } else {
            securityWarning.classList.add('hidden');
          }
        }
      }

      formatWarning.classList.add('hidden');

      const numPeers = (typeof data.numPeers === 'number') ? data.numPeers : 0;
      const progressPct = (data.progress * 100).toFixed(1);
      progressBar.style.width = `${progressPct}%`;
      progressText.textContent = `Downloaded: ${formatBytes(data.downloaded || 0)} / ${formatBytes(data.totalSize || 0)} (${progressPct}%)`;

      if (isStreamPaused || data.status === 'paused') {
        statusPill.className = 'pill pill-warning';
        statusPill.innerHTML = `<i class="fa-solid fa-pause"></i> Download Paused (${numPeers} peers preserved)`;
        statDownloadSpeed.textContent = '0 KB/s';
        statUploadSpeed.textContent = '0 KB/s';
        statPeers.textContent = `${numPeers} (Paused)`;
        etaText.textContent = 'ETA: Paused';
        return;
      }

      etaText.textContent = `ETA: ${formatTime((data.timeRemaining || 0) / 1000)}`;
      statDownloadSpeed.textContent = formatSpeed(data.downloadSpeed || 0);
      statUploadSpeed.textContent = formatSpeed(data.uploadSpeed || 0);
      statPeers.textContent = numPeers.toString();

      if (data.status === 'streaming' || data.downloadSpeed > 0 || (data.downloaded && data.downloaded > 1024 * 1024)) {
        statusPill.className = 'pill pill-success';
        statusPill.innerHTML = `<i class="fa-solid fa-signal"></i> Streaming (${numPeers} peers)`;
        playerOverlay.classList.add('hidden');
      } else if (data.status === 'completed') {
        statusPill.className = 'pill pill-success';
        statusPill.innerHTML = `<i class="fa-solid fa-check"></i> Complete`;
        playerOverlay.classList.add('hidden');
      } else {
        statusPill.className = 'pill pill-warning';
        statusPill.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Finding Peers (${numPeers})`;
        if (numPeers > 0) {
          const totalSizeText = data.totalSize ? ` (${formatBytes(data.totalSize)})` : '';
          overlayText.textContent = `Connected to ${numPeers} P2P peers. Fetching video header map${totalSizeText}... (${formatSpeed(data.downloadSpeed || 0)})`;
        } else {
          overlayText.textContent = `Searching BitTorrent swarm & DHT for active seeders (0 peers)...`;
        }
      }
    };
  }

  fileSelect.addEventListener('change', (e) => {
    currentFileIndex = parseInt(e.target.value, 10);
    fetch('/api/torrent/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ infoHash: currentInfoHash, fileIndex: currentFileIndex })
    });
    bindVideoStream(currentInfoHash, currentFileIndex);
  });





  btnStop.addEventListener('click', async () => {
    if (confirm('Stop streaming and delete temporary downloaded cache files?')) {
      videoPlayer.pause();
      videoPlayer.src = '';
      if (eventSource) eventSource.close();

      const hashToStop = currentInfoHash || 'all';
      await fetch(`/api/torrent/stop/${hashToStop}`, { method: 'POST' });

      goHome();
      currentInfoHash = null;
      alert('Stream stopped and disk cache deleted cleanly.');
    }
  });

  if (btnStreamPause) {
    btnStreamPause.addEventListener('click', async () => {
      if (!currentInfoHash) return;
      if (!isStreamPaused) {
        await fetch(`/api/torrent/pause/${currentInfoHash}`, { method: 'POST' });
        isStreamPaused = true;
        btnStreamPause.innerHTML = `<i class="fa-solid fa-play"></i> Resume Download`;
        btnStreamPause.className = 'btn btn-success btn-sm';
        statusPill.className = 'pill pill-warning';
        statusPill.innerHTML = `<i class="fa-solid fa-pause"></i> Download Paused`;
        if (pauseDisclaimer) pauseDisclaimer.classList.remove('hidden');
      } else {
        await fetch(`/api/torrent/resume/${currentInfoHash}`, { method: 'POST' });
        isStreamPaused = false;
        btnStreamPause.innerHTML = `<i class="fa-solid fa-pause"></i> Pause Download`;
        btnStreamPause.className = 'btn btn-secondary btn-sm';
        statusPill.className = 'pill pill-success';
        statusPill.innerHTML = `<i class="fa-solid fa-signal"></i> Streaming P2P`;
        if (pauseDisclaimer) {
          setTimeout(() => pauseDisclaimer.classList.add('hidden'), 10000);
        }
      }
    });
  }

  if (btnStreamCancel) {
    btnStreamCancel.addEventListener('click', async () => {
      if (confirm('Cancel download, stop streaming, and clear disk cache?')) {
        videoPlayer.pause();
        videoPlayer.src = '';
        if (eventSource) eventSource.close();

        const hashToStop = currentInfoHash || 'all';
        await fetch(`/api/torrent/stop/${hashToStop}`, { method: 'POST' });

        goHome();
        currentInfoHash = null;
        alert('Download canceled and cache deleted.');
      }
    });
  }

  function playDiskDownload(folderName, title) {
    currentDiskFolder = folderName;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    sectionDiscover.classList.add('hidden');
    sectionMagnet.classList.add('hidden');
    if (sectionDownloads) sectionDownloads.classList.add('hidden');
    if (navbarCenterSearch) navbarCenterSearch.classList.add('hidden');
    streamSection.classList.remove('hidden');

    torrentTitle.textContent = title || folderName;
    statusPill.className = 'pill pill-success';
    statusPill.innerHTML = '<i class="fa-solid fa-hard-drive"></i> Playing From Local Disk Storage';

    // Hide P2P telemetry stats grid and progress box for disk storage playback
    const statsGrid = document.querySelector('.stats-grid');
    const progressBox = document.querySelector('.progress-box');
    if (statsGrid) statsGrid.classList.add('hidden');
    if (progressBox) progressBox.classList.add('hidden');
    fileSelectorBox.classList.add('hidden');

    const streamUrl = `/api/downloads/stream/${encodeURIComponent(folderName)}`;
    videoPlayer.src = streamUrl;
    videoPlayer.play().catch(() => {});

    fetchSubtitlesForMovie(title || folderName, subLangSelect.value);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // DISK STORAGE & DOWNLOADS MANAGER LOGIC
  async function loadDownloadedStorage() {
    if (!downloadsGrid) return;
    downloadsGrid.innerHTML = `
      <div class="grid-loading">
        <i class="fa-solid fa-spinner fa-spin spinner"></i>
        <span>Scanning downloads on disk (/tmp/cinepulse_cache)...</span>
      </div>`;

    try {
      const res = await fetch(`/api/downloads/list?t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();

      if (data.success && data.items && data.items.length > 0) {
        if (storageTotalSize) {
          storageTotalSize.innerHTML = `<i class="fa-solid fa-database"></i> Total Disk Used: <strong>${data.formattedTotalBytes}</strong>`;
        }
        renderDownloadsGrid(data.items);
      } else {
        if (storageTotalSize) {
          storageTotalSize.innerHTML = `<i class="fa-solid fa-database"></i> Total Disk Used: 0 MB`;
        }
        downloadsGrid.innerHTML = `
          <div class="banner banner-info" style="grid-column: 1 / -1; margin: 2rem 0;">
            <i class="fa-solid fa-folder-open banner-icon"></i>
            <div>
              <strong>No Downloaded Movies Found</strong>
              <p>Movies streamed will be saved on disk cache and listed here for instant playback or deletion.</p>
            </div>
          </div>`;
      }
    } catch (err) {
      downloadsGrid.innerHTML = `<div class="grid-loading"><span>Failed to load downloaded items: ${err.message}</span></div>`;
    }
  }

  function renderDownloadsGrid(items) {
    downloadsGrid.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'download-item-card';

      const isMkv = item.videoFiles.some(f => f.name.endsWith('.mkv'));
      const formatBadge = isMkv ? '<span class="badge-mkv">MKV</span>' : '<span class="badge-mp4">MP4</span>';

      card.innerHTML = `
        <div class="download-card-title-row">
          <h3 class="download-card-title"><i class="fa-solid fa-film"></i> ${item.title}</h3>
          ${formatBadge}
        </div>
        <div class="download-card-meta">
          <span><i class="fa-solid fa-hard-drive"></i> Size: <strong>${item.formattedSize}</strong></span>
          <span><i class="fa-solid fa-file-video"></i> Video Files: <strong>${item.videoFiles.length}</strong></span>
        </div>
        <div class="download-card-actions">
          <button class="btn btn-primary btn-play-download" title="Play in Web Browser">
            <i class="fa-solid fa-play"></i> Play Web
          </button>
          <button class="btn btn-warning btn-vlc-download" title="Open in VLC Media Player">
            <i class="fa-solid fa-film"></i> Open in VLC
          </button>
          <button class="btn btn-danger btn-delete-download" title="Delete from disk">
            <i class="fa-solid fa-trash-can"></i> Delete
          </button>
        </div>
      `;

      card.querySelector('.btn-play-download').addEventListener('click', () => {
        playDiskDownload(item.folderName, item.title);
      });

      card.querySelector('.btn-vlc-download').addEventListener('click', async () => {
        try {
          const res = await fetch(`/api/downloads/open-vlc/${encodeURIComponent(item.folderName)}`, { method: 'POST' });
          const data = await res.json();
          if (data.success) {
            // Success launching VLC on host
          } else {
            window.location.href = `/api/downloads/m3u/${encodeURIComponent(item.folderName)}`;
          }
        } catch (e) {
          window.location.href = `/api/downloads/m3u/${encodeURIComponent(item.folderName)}`;
        }
      });

      card.querySelector('.btn-delete-download').addEventListener('click', async () => {
        if (confirm(`Delete "${item.title}" (${item.formattedSize}) permanently from disk?`)) {
          card.style.opacity = '0.5';
          if (item.infoHash) {
            await fetch(`/api/torrent/stop/${item.infoHash}`, { method: 'POST' });
          }
          const res = await fetch('/api/downloads/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName: item.folderName })
          });
          const data = await res.json();
          if (data.success) {
            loadDownloadedStorage();
          } else {
            alert('Failed to delete item: ' + (data.error || 'Unknown error'));
            card.style.opacity = '1';
          }
        }
      });

      downloadsGrid.appendChild(card);
    });
  }

  if (btnClearAllDownloads) {
    btnClearAllDownloads.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete ALL downloaded movies and clear disk cache?')) {
        if (storageTotalSize) {
          storageTotalSize.innerHTML = `<i class="fa-solid fa-database"></i> Total Disk Used: 0 B`;
        }
        downloadsGrid.innerHTML = `
          <div class="banner banner-info" style="grid-column: 1 / -1; margin: 2rem 0;">
            <i class="fa-solid fa-folder-open banner-icon"></i>
            <div>
              <strong>No Downloaded Movies Found</strong>
              <p>All downloaded movies have been deleted cleanly from disk cache.</p>
            </div>
          </div>`;

        try {
          const res = await fetch(`/api/downloads/clear-all?t=${Date.now()}`, { method: 'POST', cache: 'no-store' });
          const data = await res.json();
          loadDownloadedStorage();
        } catch (e) {
          console.error(e);
        }
      }
    });
  }
});
