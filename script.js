// ============================================
// DooMovie — Phase 1: MVP Enhancement
// All features: Theme, Filters, Infinite Scroll,
// View Modes, Mood, Surprise, Multi-Lists,
// Keyboard Shortcuts, PWA, Image Optimization
// ============================================

// ── API Configuration ──
const API_KEY = 'ba6f7d3b063751fb2bea48683e263f63';
const BASE_URL = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

// ── Genre Map (id → name) ──
const GENRE_NAMES = {
    28: 'Action', 35: 'Comedy', 18: 'Drama', 27: 'Horror', 10749: 'Romance',
    878: 'Sci-Fi', 53: 'Thriller', 16: 'Animation', 99: 'Documentary', 14: 'Fantasy',
    12: 'Adventure', 80: 'Crime', 10751: 'Family', 36: 'History', 10402: 'Music',
    9648: 'Mystery', 10752: 'War', 37: 'Western', 10770: 'TV Movie'
};

// ── Mood → Genre Mapping ──
const MOOD_MAP = {
    happy: { genres: '35,10751,16', label: 'Happy Vibes' },
    thrilled: { genres: '27,53', label: 'Thrilling' },
    romantic: { genres: '10749,18', label: 'Romantic' },
    mindblown: { genres: '878,9648', label: 'Mind-Blowing' },
    emotional: { genres: '18,10752', label: 'Emotional' },
    adventurous: { genres: '28,12,14', label: 'Adventurous' },
    curious: { genres: '99,36', label: 'Curious' },
    fun: { genres: '35,16', label: 'Fun' }
};

// ── State ──
let movieLists = [];
let activeListId = 'default';
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;
let searchTimeout = null;
let currentMood = null;
let currentFilters = {};
let carouselPages = {};
let carouselLoading = {};
let surpriseMovieId = null;

// Auth State
let currentUser = null;
let authToken = localStorage.getItem('doomovie_token') || null;
try {
    const savedUser = localStorage.getItem('doomovie_user');
    if (savedUser) currentUser = JSON.parse(savedUser);
} catch (e) { currentUser = null; }

// Initialize lists immediately
(function initLists() {
    const stored = localStorage.getItem('doomovie_lists');
    if (stored) {
        try { movieLists = JSON.parse(stored); return; } catch (e) { /* fall through */ }
    }
    // Migrate from old watchlist format
    const oldWatchlist = localStorage.getItem('doomovie_watchlist');
    let defaultMovies = [];
    if (oldWatchlist) {
        try { defaultMovies = JSON.parse(oldWatchlist); } catch (e) { /* ignore */ }
    }
    movieLists = [{ id: 'default', name: 'My List', icon: '📋', movies: defaultMovies }];
    localStorage.setItem('doomovie_lists', JSON.stringify(movieLists));
})();

// ── Backward-compatible watchlist getter ──
function getDefaultListMovies() {
    const list = movieLists.find(l => l.id === 'default');
    return list ? list.movies : [];
}

// ── List persistence ──
let syncDebounceTimer = null;
function saveLists() {
    localStorage.setItem('doomovie_lists', JSON.stringify(movieLists));
    // Keep legacy key in sync for backward compat
    const def = movieLists.find(l => l.id === 'default');
    if (def) localStorage.setItem('doomovie_watchlist', JSON.stringify(def.movies));

    // Auto sync to cloud if user is signed in
    if (authToken && currentUser) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = setTimeout(() => {
            syncWatchlistsToCloud(false);
        }, 1500);
    }
}

// ── Server API Origin Detector ──
// When user opens index.html directly via file:/// protocol, redirect API calls to http://localhost:8090
const API_SERVER_ORIGIN = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? ''
    : 'http://localhost:8090';

// ── API Fetch Helper ──
async function apiFetch(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    const fullUrl = endpoint.startsWith('http') ? endpoint : `${API_SERVER_ORIGIN}${endpoint}`;
    try {
        const res = await fetch(fullUrl, { ...options, headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }
        return data;
    } catch (err) {
        if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
            throw new Error('Tidak dapat terhubung ke server backend. Buka DooMovie melalui http://localhost:8090 di browser.');
        }
        throw err;
    }
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    setupThemeToggle();
    setupNavbar();
    setupAuthAndProfile();
    setupSearch();
    setupGenreChips();
    setupCarouselArrows();
    setupScrollToTop();
    setupMobileMenu();
    setupAdvancedFilters();
    setupMoodBrowsing();
    setupViewToggles();
    setupSurpriseMe();
    setupMultipleWatchlists();
    setupKeyboardShortcuts();
    registerServiceWorker();

    // Load data concurrently
    await Promise.all([
        loadHeroBillboard(),
        loadCarousel('trendingRow', '/trending/movie/week'),
        loadCarousel('featuredRow', '/movie/popular'),
        loadCarousel('topRatedRow', '/movie/top_rated'),
        loadCarousel('indonesianRow', '/discover/movie', { with_original_language: 'id', sort_by: 'popularity.desc' }),
        loadCarousel('indonesianTopRatedRow', '/discover/movie', { with_original_language: 'id', sort_by: 'vote_average.desc', 'vote_count.gte': 50 }),
        loadCarousel('indonesianNewRow', '/discover/movie', { with_original_language: 'id', sort_by: 'primary_release_date.desc', 'primary_release_date.lte': new Date().toISOString().slice(0, 10) }),
        loadCarousel('upcomingRow', '/movie/upcoming')
    ]);

    // Setup infinite scroll after carousels are loaded
    setupInfiniteScroll();

    // Hide page loader
    const loader = document.getElementById('pageLoader');
    if (loader) {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 600);
    }
}

// ══════════════════════════════════
// 1. THEME TOGGLE (Dark/Light Mode)
// ══════════════════════════════════

function setupThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    const html = document.documentElement;

    // Load saved theme or detect system preference
    const saved = localStorage.getItem('doomovie_theme');
    if (saved) {
        html.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        html.setAttribute('data-theme', 'light');
    }

    updateThemeIcon();

    toggle.addEventListener('click', () => {
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('doomovie_theme', next);
        updateThemeIcon();
        showToast(`Switched to ${next} mode`, 'info');
    });

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('doomovie_theme')) {
            html.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            updateThemeIcon();
        }
    });
}

function updateThemeIcon() {
    const icon = document.querySelector('#themeToggle i');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    icon.className = isDark ? 'fas fa-moon' : 'fas fa-sun';
}

// ══════════════════════════════
// 2. API HELPERS & IMAGE OPTIM
// ══════════════════════════════

async function fetchAPI(endpoint, params = {}) {
    const qp = new URLSearchParams(params);
    try {
        // Try server-side proxy first (hides TMDB key and uses server cache)
        const proxyRes = await fetch(`${API_SERVER_ORIGIN}/api/tmdb${endpoint}?${qp}`);
        if (proxyRes.ok) return await proxyRes.json();
    } catch (e) {
        // Fallback to direct client call if server proxy isn't reachable
    }

    try {
        const directQp = new URLSearchParams({ api_key: API_KEY, ...params });
        const res = await fetch(`${BASE_URL}${endpoint}?${directQp}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error('API Error:', err);
        return null;
    }
}

// Optimized image URLs — smaller sizes for better performance
function posterUrl(path, size = 'w342') {
    return path ? `${IMG}/${size}${path}` : '';
}
function backdropUrl(path, size = 'w1280') {
    return path ? `${IMG}/${size}${path}` : '';
}

// ══════════════════════
// 3. HERO BILLBOARD
// ══════════════════════

async function loadHeroBillboard() {
    const data = await fetchAPI('/trending/movie/week');
    if (!data?.results) return;

    heroSlides = data.results.slice(0, 5);
    const billboard = document.getElementById('heroBillboard');
    const dotsContainer = document.getElementById('heroDots');

    heroSlides.forEach((movie, i) => {
        const slide = document.createElement('div');
        slide.className = `hero-slide${i === 0 ? ' active' : ''}`;
        const defaultMovies = getDefaultListMovies();
        slide.innerHTML = `
      <img class="hero-backdrop" src="${backdropUrl(movie.backdrop_path)}" alt="${movie.title}" loading="${i === 0 ? 'eager' : 'lazy'}">
      <div class="hero-gradient"></div>
      <div class="hero-info">
        <div class="hero-tag"><i class="fas fa-fire"></i> Trending #${i + 1}</div>
        <h1 class="hero-title">${movie.title}</h1>
        <div class="hero-meta">
          <span class="match">${Math.floor(Math.random() * 15 + 85)}% Match</span>
          <span>${movie.release_date?.slice(0, 4) || 'N/A'}</span>
          <span><i class="fas fa-star" style="color:#ffd700;"></i> ${movie.vote_average.toFixed(1)}</span>
          <span class="rating-badge">HD</span>
        </div>
        <p class="hero-overview">${movie.overview}</p>
        <div class="hero-buttons">
          <button class="btn-hero btn-hero-play" onclick="showMovieDetails(${movie.id})">
            <i class="fas fa-play"></i> Play Trailer
          </button>
          <button class="btn-hero btn-hero-info" onclick="showMovieDetails(${movie.id})">
            <i class="fas fa-info-circle"></i> More Info
          </button>
          <button class="btn-hero btn-hero-list" onclick="toggleWatchlist(${movie.id}, '${movie.title.replace(/'/g, "\\'")}'); event.stopPropagation();">
            <i class="fas fa-${defaultMovies.includes(movie.id) ? 'check' : 'plus'}"></i> My List
          </button>
        </div>
      </div>
    `;
        billboard.insertBefore(slide, dotsContainer);

        const dot = document.createElement('button');
        dot.className = `hero-dot${i === 0 ? ' active' : ''}`;
        dot.addEventListener('click', () => goToSlide(i));
        dotsContainer.appendChild(dot);
    });

    startHeroRotation();
}

function goToSlide(index) {
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dot');
    slides[heroIndex]?.classList.remove('active');
    dots[heroIndex]?.classList.remove('active');
    heroIndex = index;
    slides[heroIndex]?.classList.add('active');
    dots[heroIndex]?.classList.add('active');
    resetHeroTimer();
}

function startHeroRotation() {
    heroTimer = setInterval(() => {
        goToSlide((heroIndex + 1) % heroSlides.length);
    }, 8000);
}

function resetHeroTimer() {
    clearInterval(heroTimer);
    startHeroRotation();
}

// ══════════════════════
// 4. CAROUSEL LOADING
// ══════════════════════

async function loadCarousel(rowId, endpoint, extraParams = {}) {
    const row = document.getElementById(rowId);
    if (!row) return;

    // Store endpoint info for infinite scroll
    row.dataset.endpoint = endpoint;
    row.dataset.params = JSON.stringify(extraParams);
    carouselPages[rowId] = 1;
    carouselLoading[rowId] = false;

    const data = await fetchAPI(endpoint, { ...extraParams, page: 1 });
    if (!data?.results) return;

    row.dataset.totalPages = data.total_pages || 1;
    row.innerHTML = '';
    data.results.forEach(movie => {
        if (!movie.poster_path) return;
        row.appendChild(createMovieCard(movie));
    });
}

async function loadMoreForCarousel(rowId) {
    if (carouselLoading[rowId]) return;

    const row = document.getElementById(rowId);
    if (!row) return;

    const currentPage = carouselPages[rowId] || 1;
    const totalPages = parseInt(row.dataset.totalPages) || 1;
    if (currentPage >= totalPages || currentPage >= 5) return; // Cap at 5 pages

    carouselLoading[rowId] = true;
    const nextPage = currentPage + 1;

    // Add loading indicator
    const loader = document.createElement('div');
    loader.className = 'carousel-load-more';
    loader.innerHTML = '<div class="mini-spinner"></div>';
    row.appendChild(loader);

    const endpoint = row.dataset.endpoint;
    let params = {};
    try { params = JSON.parse(row.dataset.params || '{}'); } catch (e) { /* ignore */ }

    const data = await fetchAPI(endpoint, { ...params, page: nextPage });

    // Remove loader
    loader.remove();
    carouselLoading[rowId] = false;

    if (!data?.results) return;

    carouselPages[rowId] = nextPage;
    data.results.forEach(movie => {
        if (!movie.poster_path) return;
        row.appendChild(createMovieCard(movie));
    });
}

// ══════════════════════════
// 5. INFINITE SCROLL SETUP
// ══════════════════════════

function setupInfiniteScroll() {
    const carouselRows = document.querySelectorAll('.carousel-row[data-endpoint]');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const row = entry.target.closest('.carousel-row');
                if (row && row.id) {
                    loadMoreForCarousel(row.id);
                }
            }
        });
    }, { root: null, rootMargin: '0px 200px 0px 0px', threshold: 0.1 });

    carouselRows.forEach(row => {
        // Observe the last card for horizontal scroll-based loading
        row.addEventListener('scroll', () => {
            const scrollLeft = row.scrollLeft;
            const scrollWidth = row.scrollWidth;
            const clientWidth = row.clientWidth;

            if (scrollLeft + clientWidth >= scrollWidth - 300) {
                loadMoreForCarousel(row.id);
            }
        });
    });
}

// ══════════════════════
// 6. MOVIE CARD
// ══════════════════════

function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';

    const year = movie.release_date?.slice(0, 4) || '';
    const rating = movie.vote_average?.toFixed(1) || 'N/A';
    const genres = (movie.genre_ids || []).slice(0, 3).map(id => GENRE_NAMES[id] || '').filter(Boolean);
    const defaultMovies = getDefaultListMovies();
    const inList = defaultMovies.includes(movie.id);

    card.innerHTML = `
    <div class="movie-card-img-wrapper">
      <img class="movie-card-poster" src="${posterUrl(movie.poster_path, 'w342')}" alt="${movie.title}" loading="lazy">
      <div class="movie-card-overlay">
        <span class="card-title">${movie.title}</span>
        <div class="card-meta">
          <span class="card-rating"><i class="fas fa-star"></i> ${rating}</span>
          <span>${year}</span>
        </div>
      </div>
    </div>
    <div class="movie-card-detail">
      <div class="card-action-row">
        <button class="card-action-btn btn-play" title="More Info" data-movie-id="${movie.id}">
          <i class="fas fa-play"></i>
        </button>
        <button class="card-action-btn btn-add-list ${inList ? 'in-list' : ''}" title="${inList ? 'Remove from List' : 'Add to List'}" data-movie-id="${movie.id}" data-movie-title="${movie.title}">
          <i class="fas fa-${inList ? 'check' : 'plus'}"></i>
        </button>
        <button class="card-action-btn" title="Like" data-movie-id="${movie.id}">
          <i class="fas fa-thumbs-up"></i>
        </button>
      </div>
      <div class="card-detail-meta">
        <span class="match-score">${Math.floor(Math.random() * 15 + 82)}% Match</span>
        <span>${year}</span>
        <span><i class="fas fa-star" style="color:#ffd700;font-size:.65rem;"></i> ${rating}</span>
      </div>
      <div class="card-detail-genres">
        ${genres.map(g => `<span>${g}</span>`).join('')}
      </div>
    </div>
  `;

    // Event: open detail
    card.querySelector('.btn-play').addEventListener('click', (e) => {
        e.stopPropagation();
        showMovieDetails(movie.id);
    });

    // Event: add/remove from list
    card.querySelector('.btn-add-list').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWatchlist(movie.id, movie.title);
        updateCardListButton(e.currentTarget, movie.id);
    });

    // Event: clicking the card itself
    card.addEventListener('click', () => showMovieDetails(movie.id));

    return card;
}

function updateCardListButton(btn, movieId) {
    const defaultMovies = getDefaultListMovies();
    const inList = defaultMovies.includes(movieId);
    btn.classList.toggle('in-list', inList);
    btn.querySelector('i').className = `fas fa-${inList ? 'check' : 'plus'}`;
    btn.title = inList ? 'Remove from List' : 'Add to List';
}

// ══════════════════════════
// 7. MOVIE DETAIL MODAL
// ══════════════════════════

async function showMovieDetails(movieId) {
    const modal = document.getElementById('movieModal');
    const body = document.getElementById('modalBody');

    modal.classList.add('visible');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    body.innerHTML = `
    <div class="modal-hero" style="background:#1e1e1e;display:flex;align-items:center;justify-content:center;">
      <div class="loader-spinner"></div>
    </div>
  `;

    const [data, similar] = await Promise.all([
        fetchAPI(`/movie/${movieId}`, { append_to_response: 'credits,videos' }),
        fetchAPI(`/movie/${movieId}/similar`)
    ]);

    if (!data) {
        body.innerHTML = '<p style="padding:40px;text-align:center;">Failed to load movie details.</p>';
        return;
    }

    // Find best available trailer / video
    const allVideos = data.videos?.results || [];
    let trailer = allVideos.find(v => v.site === 'YouTube' && v.type === 'Trailer');
    if (!trailer) trailer = allVideos.find(v => v.site === 'YouTube' && (v.type === 'Teaser' || v.type === 'Clip'));
    if (!trailer) trailer = allVideos.find(v => v.site === 'YouTube');

    const genres = data.genres?.map(g => `<span>${g.name}</span>`).join('') || '';
    const cast = data.credits?.cast?.slice(0, 12) || [];
    const year = data.release_date?.slice(0, 4) || '';
    const runtime = data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : '';
    const defaultMovies = getDefaultListMovies();
    const inList = defaultMovies.includes(movieId);

    const castHTML = cast.map(c => `
    <div class="cast-card">
      <img src="${c.profile_path ? posterUrl(c.profile_path, 'w185') : 'https://via.placeholder.com/68x68/333/666?text=?'}" alt="${c.name}">
      <div class="cast-name">${c.name}</div>
      <div class="cast-char">${c.character || ''}</div>
    </div>
  `).join('');

    const similarHTML = (similar?.results || []).filter(m => m.poster_path).slice(0, 10).map(m => `
    <div class="similar-card" onclick="showMovieDetails(${m.id})">
      <img src="${posterUrl(m.poster_path, 'w300')}" alt="${m.title}" loading="lazy">
      <p>${m.title}</p>
    </div>
  `).join('');

    // Trailer component HTML with fallback and direct YouTube link
    let trailerHTML = '';
    if (trailer) {
        trailerHTML = `
          <div class="trailer-player-container">
            <div class="video-responsive-wrapper">
              <iframe 
                src="https://www.youtube-nocookie.com/embed/${trailer.key}?enablejsapi=1&rel=0&modestbranding=1" 
                title="${escapeHtml(data.title)} Trailer" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowfullscreen>
              </iframe>
            </div>
            <div class="trailer-footer-bar">
              <div class="trailer-info-text">
                <span class="trailer-title-label"><i class="fab fa-youtube" style="color:#ff0000"></i> ${escapeHtml(trailer.name || 'Official Video')}</span>
                ${window.location.protocol === 'file:' ? '<span class="trailer-file-hint"><i class="fas fa-info-circle"></i> Jika pemutar YouTube error pada protokol file:///, klik tombol Tonton di YouTube di samping atau buka via http://localhost:8090</span>' : ''}
              </div>
              <a href="https://www.youtube.com/watch?v=${trailer.key}" target="_blank" rel="noopener noreferrer" class="btn-external-youtube">
                <i class="fab fa-youtube"></i> Tonton di YouTube <i class="fas fa-arrow-up-right-from-square" style="font-size:.72rem;"></i>
              </a>
            </div>
          </div>
        `;
    } else {
        trailerHTML = `
          <div class="trailer-empty-card">
            <i class="fab fa-youtube" style="font-size:3rem;color:#ff0000;margin-bottom:12px;display:inline-block;"></i>
            <h4>Trailer Tidak Tersedia Langsung</h4>
            <p>TMDB belum menyediakan video resmi yang dapat diputar langsung untuk film ini.</p>
            <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(data.title + ' ' + year + ' official trailer')}" target="_blank" rel="noopener noreferrer" class="btn-external-youtube">
              <i class="fas fa-search"></i> Cari Trailer di YouTube
            </a>
          </div>
        `;
    }

    body.innerHTML = `
    <div class="modal-hero">
      <img class="modal-backdrop" src="${backdropUrl(data.backdrop_path || data.poster_path)}" alt="${data.title}">
      <div class="modal-hero-gradient"></div>
      <div class="modal-hero-info">
        <h2>${data.title}</h2>
        <div class="modal-hero-buttons">
          <button class="btn-hero btn-hero-play" onclick="switchMovieTab('trailer')">
            <i class="fas fa-play"></i> Watch Trailer
          </button>
          <button class="btn-hero btn-hero-reviews" onclick="switchMovieTab('reviews')">
            <i class="fas fa-star"></i> Reviews &amp; Ratings
          </button>
          <button class="btn-hero btn-hero-list" id="modalListBtn" onclick="toggleWatchlist(${movieId}, '${data.title.replace(/'/g, "\\'")}'); updateModalListButton(${movieId});">
            <i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In My List' : 'My List'}
          </button>
        </div>
      </div>
    </div>

    <!-- Navigation Tabs inside Movie Detail Modal -->
    <div class="modal-tabs-nav">
      <button class="modal-tab-btn active" data-tab="overview" onclick="switchMovieTab('overview')">
        <i class="fas fa-align-left"></i> Overview &amp; Cast
      </button>
      <button class="modal-tab-btn" data-tab="trailer" onclick="switchMovieTab('trailer')">
        <i class="fas fa-video"></i> Trailer &amp; Media
      </button>
      <button class="modal-tab-btn" data-tab="reviews" onclick="switchMovieTab('reviews')">
        <i class="fas fa-comments"></i> Reviews &amp; Ratings <span class="tab-review-count-badge" id="modalTabReviewCount">0</span>
      </button>
    </div>

    <div class="modal-body-content">
      <!-- Tab 1: Overview & Cast -->
      <div class="modal-tab-pane active" id="tabPaneOverview">
        <div class="modal-meta-row">
          <span class="meta-match">${Math.floor(Math.random() * 12 + 88)}% Match</span>
          <span class="meta-year">${year}</span>
          ${runtime ? `<span class="meta-runtime">${runtime}</span>` : ''}
          <span class="meta-rating-badge"><i class="fas fa-star" style="color:#ffd700;margin-right:4px;"></i>${data.vote_average.toFixed(1)}</span>
        </div>
        <p class="modal-overview">${data.overview || 'No overview available.'}</p>
        <div class="modal-genres">${genres}</div>

        ${cast.length ? `
          <h3 class="modal-section-title">Top Cast</h3>
          <div class="cast-row">${castHTML}</div>
        ` : ''}

        ${similarHTML ? `
          <h3 class="modal-section-title" style="margin-top:28px;">More Like This</h3>
          <div class="similar-row">${similarHTML}</div>
        ` : ''}
      </div>

      <!-- Tab 2: Trailer Player -->
      <div class="modal-tab-pane" id="tabPaneTrailer">
        <h3 class="modal-section-title" style="margin-bottom:12px;">Official Video &amp; Trailer</h3>
        ${trailerHTML}
      </div>

      <!-- Tab 3: Community Reviews -->
      <div class="modal-tab-pane" id="tabPaneReviews">
        <div class="community-reviews-section" id="communityReviewsSection">
          <div style="padding: 20px; text-align: center;"><div class="mini-spinner"></div> Loading reviews...</div>
        </div>
      </div>
    </div>
  `;

    // Load live community reviews and stats
    loadMovieReviews(movieId, data.title);
}

function switchMovieTab(tabName) {
    document.querySelectorAll('.modal-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.modal-tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    if (tabName === 'overview') document.getElementById('tabPaneOverview')?.classList.add('active');
    if (tabName === 'trailer') document.getElementById('tabPaneTrailer')?.classList.add('active');
    if (tabName === 'reviews') document.getElementById('tabPaneReviews')?.classList.add('active');
}

function updateModalListButton(movieId) {
    const btn = document.getElementById('modalListBtn');
    if (!btn) return;
    const defaultMovies = getDefaultListMovies();
    const inList = defaultMovies.includes(movieId);
    btn.innerHTML = `<i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In My List' : 'My List'}`;
}

function closeMovieModal() {
    const modal = document.getElementById('movieModal');
    modal.classList.remove('visible');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    const iframes = modal.querySelectorAll('iframe');
    iframes.forEach(iframe => iframe.src = '');
}

// ══════════════════════════════
// 8. MULTIPLE WATCHLISTS
// ══════════════════════════════

function setupMultipleWatchlists() {
    // Create list modal
    const createBtn = document.getElementById('createListBtn');
    const modal = document.getElementById('createListModal');
    const closeBtn = document.getElementById('createListModalClose');
    const cancelBtn = document.getElementById('cancelCreateList');
    const confirmBtn = document.getElementById('confirmCreateList');

    createBtn?.addEventListener('click', () => {
        modal.classList.add('visible');
        modal.style.display = 'flex';
        document.getElementById('newListName').value = '';
        document.getElementById('newListName').focus();
    });

    const closeCreateModal = () => {
        modal.classList.remove('visible');
        modal.style.display = 'none';
    };

    closeBtn?.addEventListener('click', closeCreateModal);
    cancelBtn?.addEventListener('click', closeCreateModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeCreateModal(); });

    // Emoji picker
    document.querySelectorAll('.emoji-pick').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.emoji-pick').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // Confirm create
    confirmBtn?.addEventListener('click', () => {
        const name = document.getElementById('newListName').value.trim();
        if (!name) {
            showToast('Please enter a list name', 'error');
            return;
        }
        const emoji = document.querySelector('.emoji-pick.selected')?.dataset.emoji || '📋';
        const newList = {
            id: 'list_' + Date.now(),
            name: name,
            icon: emoji,
            movies: []
        };
        movieLists.push(newList);
        saveLists();
        closeCreateModal();
        renderListTabs();
        showToast(`Created "${emoji} ${name}"`, 'success');
    });

    renderListTabs();
}

function renderListTabs() {
    const tabsContainer = document.getElementById('listTabs');
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '';
    movieLists.forEach(list => {
        const tab = document.createElement('button');
        tab.className = `list-tab${list.id === activeListId ? ' active' : ''}`;
        tab.textContent = `${list.icon} ${list.name} (${list.movies.length})`;
        tab.addEventListener('click', () => {
            activeListId = list.id;
            document.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            refreshMyList();
        });

        // Right-click to delete (non-default lists only)
        if (list.id !== 'default') {
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (confirm(`Delete "${list.name}"?`)) {
                    movieLists = movieLists.filter(l => l.id !== list.id);
                    if (activeListId === list.id) activeListId = 'default';
                    saveLists();
                    renderListTabs();
                    refreshMyList();
                    showToast(`Deleted "${list.name}"`, 'info');
                }
            });
        }

        tabsContainer.appendChild(tab);
    });
}

function toggleWatchlist(movieId, title = '') {
    const list = movieLists.find(l => l.id === activeListId) || movieLists[0];
    const idx = list.movies.indexOf(movieId);
    if (idx === -1) {
        list.movies.push(movieId);
        showToast(`Added "${title || 'Movie'}" to ${list.icon} ${list.name}`, 'success');
    } else {
        list.movies.splice(idx, 1);
        showToast(`Removed "${title || 'Movie'}" from ${list.icon} ${list.name}`, 'info');
    }
    saveLists();
    renderListTabs();
    refreshMyList();
    updateHeroBillboardListButtons();
}

function isInAnyList(movieId) {
    return movieLists.some(l => l.movies.includes(movieId));
}

async function refreshMyList() {
    const row = document.getElementById('myListRow');
    if (!row) return;

    const list = movieLists.find(l => l.id === activeListId) || movieLists[0];

    if (list.movies.length === 0) {
        row.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.id = 'myListEmpty';
        empty.innerHTML = `
      <i class="fas fa-bookmark"></i>
      <h3>${list.icon} ${list.name} is empty</h3>
      <p>Add movies to this list by clicking the + button on any movie card.</p>
    `;
        row.appendChild(empty);
        return;
    }

    row.innerHTML = '';
    const promises = list.movies.map(id => fetchAPI(`/movie/${id}`));
    const movies = await Promise.all(promises);
    movies.forEach(movie => {
        if (movie && movie.poster_path) {
            movie.genre_ids = movie.genres?.map(g => g.id) || [];
            row.appendChild(createMovieCard(movie));
        }
    });
}

function updateHeroBillboardListButtons() {
    const defaultMovies = getDefaultListMovies();
    document.querySelectorAll('.hero-slide .btn-hero-list').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        const match = onclick.match(/toggleWatchlist\((\d+)/);
        if (match) {
            const id = parseInt(match[1]);
            const inList = defaultMovies.includes(id);
            btn.querySelector('i').className = `fas fa-${inList ? 'check' : 'plus'}`;
        }
    });
}

// ══════════════════════════════
// 9. ADVANCED FILTERS
// ══════════════════════════════

function setupAdvancedFilters() {
    const toggleBtn = document.getElementById('filterToggleBtn');
    const panel = document.getElementById('advancedFilterPanel');
    const applyBtn = document.getElementById('filterApplyBtn');
    const resetBtn = document.getElementById('filterResetBtn');
    const ratingSlider = document.getElementById('filterRating');
    const ratingValue = document.getElementById('filterRatingValue');

    toggleBtn?.addEventListener('click', () => {
        panel.classList.toggle('open');
        toggleBtn.classList.toggle('active');
    });

    ratingSlider?.addEventListener('input', () => {
        ratingValue.textContent = ratingSlider.value;
    });

    applyBtn?.addEventListener('click', () => {
        applyFilters();
        showToast('Filters applied', 'success');
    });

    resetBtn?.addEventListener('click', () => {
        document.getElementById('filterYear').value = '';
        document.getElementById('filterRating').value = '0';
        document.getElementById('filterSort').value = 'popularity.desc';
        document.getElementById('filterLanguage').value = '';
        ratingValue.textContent = '0';
        currentFilters = {};
        // Reset genre chips
        document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.genre-chip[data-genre=""]')?.classList.add('active');
        resetAllCarousels();
        showToast('Filters reset', 'info');
    });
}

function applyFilters() {
    const year = document.getElementById('filterYear')?.value;
    const rating = document.getElementById('filterRating')?.value;
    const sort = document.getElementById('filterSort')?.value;
    const language = document.getElementById('filterLanguage')?.value;
    const activeGenre = document.querySelector('.genre-chip.active')?.dataset.genre;

    const params = {};
    if (activeGenre) params.with_genres = activeGenre;
    if (sort) params.sort_by = sort;
    if (language) params.with_original_language = language;
    if (rating && parseFloat(rating) > 0) {
        params['vote_average.gte'] = rating;
        params['vote_count.gte'] = 50;
    }

    if (year) {
        if (year === 'classic') {
            params['primary_release_date.lte'] = '1979-12-31';
        } else if (year.length === 4) {
            const y = parseInt(year);
            if (y >= 2020) {
                params['primary_release_date.gte'] = `${y}-01-01`;
                params['primary_release_date.lte'] = `${y}-12-31`;
            } else {
                // Decade
                params['primary_release_date.gte'] = `${y}-01-01`;
                params['primary_release_date.lte'] = `${y + 9}-12-31`;
            }
        }
    }

    currentFilters = params;

    // Reload carousels with filters
    Promise.all([
        loadCarousel('trendingRow', '/discover/movie', { ...params, sort_by: params.sort_by || 'popularity.desc' }),
        loadCarousel('featuredRow', '/discover/movie', { ...params, sort_by: params.sort_by || 'popularity.desc', page: 2 }),
        loadCarousel('topRatedRow', '/discover/movie', { ...params, sort_by: 'vote_average.desc', 'vote_count.gte': 200 }),
        loadCarousel('upcomingRow', '/discover/movie', { ...params, 'primary_release_date.gte': new Date().toISOString().slice(0, 10) })
    ]);
}

async function resetAllCarousels() {
    await Promise.all([
        loadCarousel('trendingRow', '/trending/movie/week'),
        loadCarousel('featuredRow', '/movie/popular'),
        loadCarousel('topRatedRow', '/movie/top_rated'),
        loadCarousel('indonesianRow', '/discover/movie', { with_original_language: 'id', sort_by: 'popularity.desc' }),
        loadCarousel('indonesianTopRatedRow', '/discover/movie', { with_original_language: 'id', sort_by: 'vote_average.desc', 'vote_count.gte': 50 }),
        loadCarousel('indonesianNewRow', '/discover/movie', { with_original_language: 'id', sort_by: 'primary_release_date.desc', 'primary_release_date.lte': new Date().toISOString().slice(0, 10) }),
        loadCarousel('upcomingRow', '/movie/upcoming')
    ]);
}

// ══════════════════════════════
// 10. MOOD-BASED BROWSING
// ══════════════════════════════

function setupMoodBrowsing() {
    document.querySelectorAll('.mood-card').forEach(card => {
        card.addEventListener('click', () => {
            const mood = card.dataset.mood;

            // Toggle mood
            if (currentMood === mood) {
                currentMood = null;
                card.classList.remove('active');
                resetAllCarousels();
                showToast('Mood filter cleared', 'info');
                return;
            }

            currentMood = mood;
            document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const moodData = MOOD_MAP[mood];
            if (!moodData) return;

            // Reset genre chips
            document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
            document.querySelector('.genre-chip[data-genre=""]')?.classList.add('active');

            // Filter carousels by mood genres
            const params = { with_genres: moodData.genres };
            Promise.all([
                loadCarousel('trendingRow', '/discover/movie', { ...params, sort_by: 'popularity.desc' }),
                loadCarousel('featuredRow', '/discover/movie', { ...params, sort_by: 'popularity.desc', page: 2 }),
                loadCarousel('topRatedRow', '/discover/movie', { ...params, sort_by: 'vote_average.desc', 'vote_count.gte': 200 }),
                loadCarousel('upcomingRow', '/discover/movie', { ...params, 'primary_release_date.gte': new Date().toISOString().slice(0, 10) })
            ]);

            showToast(`${card.querySelector('.mood-emoji').textContent} Showing ${moodData.label} movies`, 'success');

            // Scroll to content
            document.getElementById('sectionTrending')?.scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// ══════════════════════════════
// 11. VIEW MODE TOGGLE
// ══════════════════════════════

function setupViewToggles() {
    document.querySelectorAll('.view-toggle-group').forEach(group => {
        const targetRowId = group.dataset.target;
        const buttons = group.querySelectorAll('.view-toggle-btn');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                const row = document.getElementById(targetRowId);
                if (!row) return;

                // Update button state
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update row class
                row.classList.remove('view-grid', 'view-list');
                if (view === 'grid') row.classList.add('view-grid');
                else if (view === 'list') row.classList.add('view-list');

                // Save preference
                localStorage.setItem(`doomovie_view_${targetRowId}`, view);
            });
        });

        // Restore saved preference
        const saved = localStorage.getItem(`doomovie_view_${targetRowId}`);
        if (saved && saved !== 'carousel') {
            const btn = group.querySelector(`[data-view="${saved}"]`);
            if (btn) btn.click();
        }
    });
}

// ══════════════════════════════
// 12. SURPRISE ME
// ══════════════════════════════

function setupSurpriseMe() {
    const fab = document.getElementById('surpriseFab');
    const overlay = document.getElementById('surpriseOverlay');
    const closeBtn = document.getElementById('surpriseClose');
    const infoBtn = document.getElementById('surpriseInfoBtn');
    const addBtn = document.getElementById('surpriseAddBtn');
    const againBtn = document.getElementById('surpriseAgainBtn');

    fab?.addEventListener('click', () => triggerSurprise());
    closeBtn?.addEventListener('click', closeSurprise);
    overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeSurprise(); });
    againBtn?.addEventListener('click', () => triggerSurprise());

    infoBtn?.addEventListener('click', () => {
        if (surpriseMovieId) {
            closeSurprise();
            showMovieDetails(surpriseMovieId);
        }
    });

    addBtn?.addEventListener('click', () => {
        if (surpriseMovieId) {
            const title = document.getElementById('surpriseTitle')?.textContent || '';
            toggleWatchlist(surpriseMovieId, title);
            const defaultMovies = getDefaultListMovies();
            const inList = defaultMovies.includes(surpriseMovieId);
            addBtn.innerHTML = `<i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In List' : 'My List'}`;
        }
    });
}

async function triggerSurprise() {
    const overlay = document.getElementById('surpriseOverlay');
    const poster = document.getElementById('surprisePoster');
    const title = document.getElementById('surpriseTitle');
    const actions = document.getElementById('surpriseActions');
    const roulette = document.getElementById('surpriseRoulette');

    overlay.classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Reset state
    title.classList.remove('revealed');
    actions.classList.remove('revealed');
    poster.style.opacity = '0.3';
    roulette.style.animation = 'none';

    // Show loading state
    poster.src = '';
    title.textContent = 'Finding your movie...';
    title.classList.add('revealed');

    // Fetch random movie
    const randomPage = Math.floor(Math.random() * 100) + 1;
    const data = await fetchAPI('/discover/movie', {
        sort_by: 'popularity.desc',
        page: randomPage,
        'vote_count.gte': 20
    });

    if (!data?.results?.length) {
        title.textContent = 'No movies found. Try again!';
        return;
    }

    const movies = data.results.filter(m => m.poster_path);
    const movie = movies[Math.floor(Math.random() * movies.length)];

    if (!movie) {
        title.textContent = 'No movies found. Try again!';
        return;
    }

    surpriseMovieId = movie.id;

    // Animate reveal
    title.classList.remove('revealed');
    title.textContent = '';

    // Quick "roulette" effect with poster changes
    const quickMovies = movies.slice(0, Math.min(8, movies.length));
    let i = 0;
    const spinInterval = setInterval(() => {
        const m = quickMovies[i % quickMovies.length];
        poster.src = posterUrl(m.poster_path, 'w342');
        poster.style.opacity = '0.5';
        i++;
    }, 120);

    setTimeout(() => {
        clearInterval(spinInterval);

        // Final reveal
        poster.src = posterUrl(movie.poster_path, 'w500');
        poster.style.opacity = '1';
        poster.style.transition = 'opacity .5s ease';

        title.textContent = movie.title;
        title.classList.add('revealed');

        const defaultMovies = getDefaultListMovies();
        const inList = defaultMovies.includes(movie.id);
        document.getElementById('surpriseAddBtn').innerHTML = `<i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In List' : 'My List'}`;
        actions.classList.add('revealed');

        // Confetti!
        spawnConfetti();
    }, 1200);
}

function closeSurprise() {
    const overlay = document.getElementById('surpriseOverlay');
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
}

function spawnConfetti() {
    const colors = ['#E50914', '#46d369', '#ffd700', '#6366f1', '#ec4899', '#3b82f6'];
    for (let i = 0; i < 40; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 0.8 + 's';
        piece.style.animationDuration = (Math.random() * 1.5 + 2) + 's';
        piece.style.width = (Math.random() * 8 + 5) + 'px';
        piece.style.height = (Math.random() * 8 + 5) + 'px';
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 3500);
    }
}

// ══════════════════════════════
// 13. KEYBOARD SHORTCUTS
// ══════════════════════════════

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (e.key === 'Escape') {
                e.target.blur();
            }
            return;
        }

        switch (e.key) {
            case '/':
                e.preventDefault();
                const searchInput = document.getElementById('navSearchInput');
                searchInput.classList.add('expanded');
                searchInput.focus();
                break;
            case 'Escape':
                closeAllModals();
                break;
            case 'ArrowLeft':
                if (!isAnyModalOpen()) {
                    goToSlide((heroIndex - 1 + heroSlides.length) % heroSlides.length);
                }
                break;
            case 'ArrowRight':
                if (!isAnyModalOpen()) {
                    goToSlide((heroIndex + 1) % heroSlides.length);
                }
                break;
            case '?':
                e.preventDefault();
                toggleShortcutsModal();
                break;
            case 's':
            case 'S':
                if (!isAnyModalOpen()) {
                    triggerSurprise();
                }
                break;
            case 'd':
            case 'D':
                if (!isAnyModalOpen()) {
                    document.getElementById('themeToggle')?.click();
                }
                break;
            case 'l':
            case 'L':
                if (!isAnyModalOpen()) {
                    handleNavigation('mylist');
                    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                    document.querySelectorAll('[data-section="mylist"]').forEach(l => l.classList.add('active'));
                }
                break;
            case 't':
            case 'T':
                if (!isAnyModalOpen()) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
                break;
        }
    });

    // Shortcuts modal close
    document.getElementById('shortcutsModalClose')?.addEventListener('click', () => {
        closeModal('shortcutsModal');
    });
    document.getElementById('shortcutsModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'shortcutsModal') closeModal('shortcutsModal');
    });
}

function toggleShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    if (modal.classList.contains('visible')) {
        closeModal('shortcutsModal');
    } else {
        modal.classList.add('visible');
        modal.style.display = 'flex';
    }
}

function isAnyModalOpen() {
    return document.querySelector('.modal.visible') !== null ||
        document.querySelector('.surprise-overlay.visible') !== null;
}

function closeAllModals() {
    closeMovieModal();
    closeAboutModal();
    closeSurprise();
    closeModal('shortcutsModal');
    closeModal('createListModal');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.remove('visible');
        modal.style.display = 'none';
    }
    // Only restore overflow if no other modals are open
    if (!document.querySelector('.modal.visible')) {
        document.body.style.overflow = '';
    }
}

// ══════════════════════════════
// 14. TOAST NOTIFICATIONS
// ══════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    toast.innerHTML = `
    <span class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></span>
    <span>${message}</span>
  `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// ══════════════════════
// 15. NAVBAR
// ══════════════════════

function setupNavbar() {
    window.addEventListener('scroll', () => {
        const navbar = document.getElementById('navbar');
        if (window.scrollY > 60) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Modal close
    document.getElementById('movieModalClose').addEventListener('click', closeMovieModal);

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal.id === 'movieModal') closeMovieModal();
                else if (modal.id === 'aboutModal') closeAboutModal();
            }
        });
    });

    // Nav link click handling
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.dataset.section;
            handleNavigation(section);

            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll(`[data-section="${section}"]`).forEach(l => l.classList.add('active'));
        });
    });
}

function handleNavigation(section) {
    const myListSection = document.getElementById('sectionMyList');

    switch (section) {
        case 'home':
            window.scrollTo({ top: 0, behavior: 'smooth' });
            myListSection.style.display = 'none';
            break;
        case 'movies':
            document.getElementById('sectionFeatured')?.scrollIntoView({ behavior: 'smooth' });
            myListSection.style.display = 'none';
            break;
        case 'mylist':
            myListSection.style.display = 'block';
            refreshMyList();
            myListSection.scrollIntoView({ behavior: 'smooth' });
            break;
        case 'trending':
            document.getElementById('sectionTrending')?.scrollIntoView({ behavior: 'smooth' });
            myListSection.style.display = 'none';
            break;
    }
}

// ══════════════════════
// 16. SEARCH
// ══════════════════════

function setupSearch() {
    const toggle = document.getElementById('searchToggle');
    const input = document.getElementById('navSearchInput');
    const dropdown = document.getElementById('searchDropdown');

    toggle.addEventListener('click', () => {
        input.classList.toggle('expanded');
        if (input.classList.contains('expanded')) {
            input.focus();
        } else {
            input.value = '';
            dropdown.classList.remove('visible');
        }
    });

    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = input.value.trim();
        if (query.length < 2) {
            dropdown.classList.remove('visible');
            return;
        }
        searchTimeout = setTimeout(() => performSearch(query), 350);
    });

    // Close search on click outside
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('navSearchWrapper');
        if (!wrapper.contains(e.target)) {
            input.classList.remove('expanded');
            input.value = '';
            dropdown.classList.remove('visible');
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.classList.remove('expanded');
            input.value = '';
            dropdown.classList.remove('visible');
            input.blur();
        }
    });
}

async function performSearch(query) {
    const dropdown = document.getElementById('searchDropdown');
    const data = await fetchAPI('/search/movie', { query });

    if (!data?.results?.length) {
        dropdown.innerHTML = '<div style="padding:20px;text-align:center;color:#808080;font-size:.85rem;">No results found</div>';
        dropdown.classList.add('visible');
        return;
    }

    dropdown.innerHTML = data.results.slice(0, 8).map(movie => `
    <div class="search-result-item" onclick="showMovieDetails(${movie.id}); document.getElementById('searchDropdown').classList.remove('visible');">
      <img src="${movie.poster_path ? posterUrl(movie.poster_path, 'w92') : 'https://via.placeholder.com/44x66/333/666?text=?'}" alt="${movie.title}">
      <div class="search-result-info">
        <h4>${movie.title}</h4>
        <span>${movie.release_date?.slice(0, 4) || 'N/A'} • <i class="fas fa-star" style="color:#ffd700;"></i> ${movie.vote_average?.toFixed(1) || 'N/A'}</span>
      </div>
    </div>
  `).join('');

    dropdown.classList.add('visible');
}

// ══════════════════════════
// 17. GENRE QUICK FILTERS
// ══════════════════════════

function setupGenreChips() {
    const chips = document.querySelectorAll('.genre-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            // Clear mood selection
            currentMood = null;
            document.querySelectorAll('.mood-card').forEach(c => c.classList.remove('active'));

            const genreId = chip.dataset.genre;
            filterByGenre(genreId);
        });
    });
}

async function filterByGenre(genreId) {
    if (!genreId) {
        await resetAllCarousels();
        return;
    }

    const params = { with_genres: genreId };
    await Promise.all([
        loadCarousel('trendingRow', '/discover/movie', { ...params, sort_by: 'popularity.desc' }),
        loadCarousel('featuredRow', '/discover/movie', { ...params, sort_by: 'popularity.desc', page: 2 }),
        loadCarousel('topRatedRow', '/discover/movie', { ...params, sort_by: 'vote_average.desc', 'vote_count.gte': 200 }),
        loadCarousel('indonesianRow', '/discover/movie', { ...params, with_original_language: 'id' }),
        loadCarousel('indonesianTopRatedRow', '/discover/movie', { ...params, with_original_language: 'id', sort_by: 'vote_average.desc', 'vote_count.gte': 10 }),
        loadCarousel('indonesianNewRow', '/discover/movie', { ...params, with_original_language: 'id', sort_by: 'primary_release_date.desc' }),
        loadCarousel('upcomingRow', '/discover/movie', { ...params, 'primary_release_date.gte': new Date().toISOString().slice(0, 10) })
    ]);
}

// ══════════════════════════════
// 18. CAROUSEL ARROW NAVIGATION
// ══════════════════════════════

function setupCarouselArrows() {
    document.querySelectorAll('.carousel-wrapper').forEach(wrapper => {
        const row = wrapper.querySelector('.carousel-row');
        const leftBtn = wrapper.querySelector('.carousel-arrow-left');
        const rightBtn = wrapper.querySelector('.carousel-arrow-right');
        if (!row || !leftBtn || !rightBtn) return;

        const scrollAmount = () => row.clientWidth * 0.75;

        leftBtn.addEventListener('click', () => {
            row.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
        });
        rightBtn.addEventListener('click', () => {
            row.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
        });
    });
}

// ══════════════════════
// 19. SCROLL TO TOP
// ══════════════════════

function setupScrollToTop() {
    const btn = document.getElementById('scrollTopBtn');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 600) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    });
    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ══════════════════════
// 20. MOBILE MENU
// ══════════════════════

function setupMobileMenu() {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('mobileNavOverlay');
    const closeBtn = document.getElementById('mobileNavClose');

    menuBtn?.addEventListener('click', () => {
        overlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
    });
    closeBtn?.addEventListener('click', closeMobileNav);
}

function closeMobileNav() {
    const overlay = document.getElementById('mobileNavOverlay');
    overlay.classList.remove('visible');
    document.body.style.overflow = '';
}

// ══════════════════════
// 21. ABOUT MODAL
// ══════════════════════

function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    modal.classList.add('visible');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    modal.classList.remove('visible');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// ══════════════════════════
// 22. PWA SERVICE WORKER
// ══════════════════════════

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered:', reg.scope))
            .catch(err => console.log('SW registration failed:', err));
    }

    // Handle install prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        // Could show a custom install button here
        console.log('PWA install prompt available');
    });
}

// ════════════════════════════════════════════════════════
// 23. PHASE 2: AUTH, USER PROFILE & COMMUNITY REVIEWS
// ════════════════════════════════════════════════════════

function setupAuthAndProfile() {
    const openAuthBtn = document.getElementById('openAuthBtn');
    const authModal = document.getElementById('authModal');
    const authModalClose = document.getElementById('authModalClose');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchToRegister = document.getElementById('switchToRegister');
    const switchToLogin = document.getElementById('switchToLogin');
    const userMenuWrapper = document.getElementById('userMenuWrapper');
    const userAvatarBtn = document.getElementById('userAvatarBtn');
    const openProfileBtn = document.getElementById('openProfileBtn');
    const profileModal = document.getElementById('profileModal');
    const profileModalClose = document.getElementById('profileModalClose');
    const saveBioBtn = document.getElementById('saveBioBtn');
    const syncWatchlistBtn = document.getElementById('syncWatchlistBtn');
    const profileSyncCloudBtn = document.getElementById('profileSyncCloudBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const profileSignoutBtn = document.getElementById('profileSignoutBtn');

    // Tab Switchers
    const switchTab = (tab) => {
        const isLogin = tab === 'login';
        tabLoginBtn?.classList.toggle('active', isLogin);
        tabRegisterBtn?.classList.toggle('active', !isLogin);
        loginForm?.classList.toggle('active', isLogin);
        registerForm?.classList.toggle('active', !isLogin);
        hideAuthAlert();
    };

    tabLoginBtn?.addEventListener('click', () => switchTab('login'));
    tabRegisterBtn?.addEventListener('click', () => switchTab('register'));
    switchToRegister?.addEventListener('click', (e) => { e.preventDefault(); switchTab('register'); });
    switchToLogin?.addEventListener('click', (e) => { e.preventDefault(); switchTab('login'); });

    // Open/Close Auth Modal
    openAuthBtn?.addEventListener('click', () => openAuthModal('login'));
    authModalClose?.addEventListener('click', closeAuthModal);
    authModal?.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

    // Password visibility toggles
    document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.querySelector('i').className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
        });
    });

    // Register Avatar Picker
    document.querySelectorAll('#regAvatarPicker .avatar-pick').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#regAvatarPicker .avatar-pick').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
    });

    // Login Form Submit
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identifier = document.getElementById('loginIdentifier').value.trim();
        const password = document.getElementById('loginPassword').value;
        const submitBtn = document.getElementById('loginSubmitBtn');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="mini-spinner"></div> Signing In...';
        hideAuthAlert();

        try {
            const data = await apiFetch('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ identifier, password })
            });

            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('doomovie_token', authToken);
            localStorage.setItem('doomovie_user', JSON.stringify(currentUser));

            updateNavbarAuthState();
            closeAuthModal();
            showToast(`Welcome back, ${currentUser.username}! 🎬`, 'success');

            // Sync watchlist with cloud
            syncWatchlistsToCloud(false);
        } catch (err) {
            showAuthAlert(err.message || 'Login failed. Please check your credentials.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Sign In</span> <i class="fas fa-arrow-right"></i>';
        }
    });

    // Register Form Submit
    registerForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('regUsername').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const avatar = document.querySelector('#regAvatarPicker .avatar-pick.selected')?.dataset.avatar || '🍿';
        const submitBtn = document.getElementById('regSubmitBtn');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="mini-spinner"></div> Creating Account...';
        hideAuthAlert();

        try {
            const data = await apiFetch('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({ username, email, password, avatar })
            });

            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('doomovie_token', authToken);
            localStorage.setItem('doomovie_user', JSON.stringify(currentUser));

            updateNavbarAuthState();
            closeAuthModal();
            showToast(`Account created! Welcome to DooMovie, ${currentUser.username}! 🎉`, 'success');

            // Initial cloud sync
            syncWatchlistsToCloud(false);
        } catch (err) {
            showAuthAlert(err.message || 'Registration failed.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Create Account</span> <i class="fas fa-sparkles"></i>';
        }
    });

    // User Menu Toggle
    userAvatarBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenuWrapper?.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!userMenuWrapper?.contains(e.target)) {
            userMenuWrapper?.classList.remove('active');
        }
    });

    // Profile Modal
    openProfileBtn?.addEventListener('click', () => {
        userMenuWrapper?.classList.remove('active');
        openProfileModal();
    });
    profileModalClose?.addEventListener('click', closeProfileModal);
    profileModal?.addEventListener('click', (e) => { if (e.target === profileModal) closeProfileModal(); });

    // Save Bio
    saveBioBtn?.addEventListener('click', async () => {
        const bio = document.getElementById('profileBioInput')?.value || '';
        try {
            saveBioBtn.disabled = true;
            saveBioBtn.textContent = 'Saving...';
            const data = await apiFetch('/api/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({ bio, avatar: currentUser?.avatar || '🍿' })
            });
            currentUser = data.user;
            localStorage.setItem('doomovie_user', JSON.stringify(currentUser));
            showToast('Bio updated successfully!', 'success');
        } catch (err) {
            showToast('Failed to update bio', 'error');
        } finally {
            saveBioBtn.disabled = false;
            saveBioBtn.textContent = 'Update Bio';
        }
    });

    // Sync Watchlists
    syncWatchlistBtn?.addEventListener('click', () => {
        userMenuWrapper?.classList.remove('active');
        syncWatchlistsToCloud(true);
    });
    profileSyncCloudBtn?.addEventListener('click', () => {
        syncWatchlistsToCloud(true);
    });

    // Logout
    const handleLogout = () => {
        authToken = null;
        currentUser = null;
        localStorage.removeItem('doomovie_token');
        localStorage.removeItem('doomovie_user');
        userMenuWrapper?.classList.remove('active');
        closeProfileModal();
        updateNavbarAuthState();
        showToast('Signed out of DooMovie', 'info');
    };
    logoutBtn?.addEventListener('click', handleLogout);
    profileSignoutBtn?.addEventListener('click', handleLogout);

    // Initial auth verification if token exists
    if (authToken) {
        apiFetch('/api/auth/me')
            .then(data => {
                currentUser = data.user;
                localStorage.setItem('doomovie_user', JSON.stringify(currentUser));
                updateNavbarAuthState();
            })
            .catch(() => {
                // Token expired or invalid
                authToken = null;
                currentUser = null;
                localStorage.removeItem('doomovie_token');
                localStorage.removeItem('doomovie_user');
                updateNavbarAuthState();
            });
    } else {
        updateNavbarAuthState();
    }
}

function updateNavbarAuthState() {
    const openAuthBtn = document.getElementById('openAuthBtn');
    const userMenuWrapper = document.getElementById('userMenuWrapper');

    if (currentUser && authToken) {
        if (openAuthBtn) openAuthBtn.style.display = 'none';
        if (userMenuWrapper) userMenuWrapper.style.display = 'block';

        const navAvatar = document.getElementById('navUserAvatar');
        const navName = document.getElementById('navUserName');
        const dropAvatar = document.getElementById('dropdownUserAvatar');
        const dropName = document.getElementById('dropdownUsername');
        const dropEmail = document.getElementById('dropdownEmail');

        if (navAvatar) navAvatar.textContent = currentUser.avatar || '🍿';
        if (navName) navName.textContent = currentUser.username;
        if (dropAvatar) dropAvatar.textContent = currentUser.avatar || '🍿';
        if (dropName) dropName.textContent = currentUser.username;
        if (dropEmail) dropEmail.textContent = currentUser.email;
    } else {
        if (openAuthBtn) openAuthBtn.style.display = 'inline-flex';
        if (userMenuWrapper) userMenuWrapper.style.display = 'none';
    }
}

function openAuthModal(tab = 'login', message = null) {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.add('visible');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    const isLogin = tab === 'login';
    tabLoginBtn?.classList.toggle('active', isLogin);
    tabRegisterBtn?.classList.toggle('active', !isLogin);
    loginForm?.classList.toggle('active', isLogin);
    registerForm?.classList.toggle('active', !isLogin);

    if (message) {
        showAuthAlert(message, 'error');
    } else {
        hideAuthAlert();
    }
}

function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.remove('visible');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

function showAuthAlert(msg, type = 'error') {
    const alert = document.getElementById('authAlert');
    if (!alert) return;
    alert.className = `auth-alert ${type}`;
    alert.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
    alert.style.display = 'flex';
}

function hideAuthAlert() {
    const alert = document.getElementById('authAlert');
    if (alert) alert.style.display = 'none';
}

async function openProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal || !currentUser) return;

    modal.classList.add('visible');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    document.getElementById('profileModalAvatar').textContent = currentUser.avatar || '🍿';
    document.getElementById('profileModalUsername').textContent = currentUser.username;
    document.getElementById('profileModalEmail').textContent = currentUser.email;

    const memberDate = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '2026';
    document.getElementById('profileModalMemberSince').textContent = `Member since ${memberDate}`;
    document.getElementById('profileBioInput').value = currentUser.bio || '';

    // Fetch real-time user statistics
    try {
        const data = await apiFetch('/api/auth/me');
        if (data.stats) {
            document.getElementById('statListsCount').textContent = data.stats.listsCount;
            document.getElementById('statMoviesCount').textContent = data.stats.savedMoviesCount;
            document.getElementById('statReviewsCount').textContent = data.stats.reviewsCount;
            document.getElementById('statAvgRating').textContent = data.stats.avgRating ? `${data.stats.avgRating} ★` : '-';
        }
    } catch (e) {
        // Fallback to local counts
        document.getElementById('statListsCount').textContent = movieLists.length;
        const totalSaved = movieLists.reduce((acc, l) => acc + (l.movies?.length || 0), 0);
        document.getElementById('statMoviesCount').textContent = totalSaved;
    }
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    modal.classList.remove('visible');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function syncWatchlistsToCloud(showToastFeedback = true) {
    if (!authToken || !currentUser) {
        if (showToastFeedback) {
            openAuthModal('login', 'Please sign in to sync watchlists across devices');
        }
        return;
    }

    try {
        if (showToastFeedback) showToast('Syncing watchlists to cloud...', 'info');
        const data = await apiFetch('/api/lists/sync', {
            method: 'POST',
            body: JSON.stringify({ lists: movieLists })
        });
        if (showToastFeedback) {
            showToast('Watchlists synced successfully with your account! ☁️', 'success');
        }
    } catch (err) {
        console.error('Sync error:', err);
        if (showToastFeedback) showToast('Could not sync watchlists. Please check connection.', 'error');
    }
}

// ── Community & TMDB API Reviews & Star Ratings ──
async function loadMovieReviews(movieId, movieTitle) {
    const container = document.getElementById('communityReviewsSection');
    if (!container) return;

    container.innerHTML = `
        <div style="padding:48px 20px;text-align:center;color:var(--color-text-dim)">
            <div class="mini-spinner" style="margin:0 auto 12px"></div>
            <div>Loading reviews &amp; ratings from DooMovie Community &amp; TMDB...</div>
        </div>
    `;

    // Concurrently fetch local community reviews and TMDB API reviews
    const [communityRes, tmdbRes] = await Promise.allSettled([
        apiFetch(`/api/movies/${movieId}/reviews`).catch(err => {
            console.warn('Backend reviews fetch failed, reading local reviews cache:', err);
            const local = JSON.parse(localStorage.getItem(`doomovie_reviews_${movieId}`) || '[]');
            return { reviews: local, stats: null };
        }),
        fetchAPI(`/movie/${movieId}/reviews`)
    ]);

    // 1. Process DooMovie Community reviews
    let communityReviews = [];
    if (communityRes.status === 'fulfilled' && communityRes.value?.reviews) {
        communityReviews = communityRes.value.reviews.map(r => ({
            id: r.id,
            source: 'doomovie',
            sourceLabel: 'DooMovie Member',
            author: r.username || 'Cinephile',
            handle: `@${(r.username || 'cinephile').toLowerCase().replace(/\s+/g, '')}`,
            avatar: r.avatar || '🍿',
            avatar_type: 'emoji',
            avatar_initials: '🍿',
            rating: typeof r.rating === 'number' ? r.rating : null,
            content: r.content || '',
            has_spoilers: !!r.has_spoilers,
            likes_count: r.likes_count || 0,
            user_has_liked: !!r.user_has_liked,
            created_at: r.created_at,
            url: null
        }));
    }

    // 2. Process TMDB API reviews
    let tmdbReviews = [];
    if (tmdbRes.status === 'fulfilled' && tmdbRes.value?.results) {
        tmdbReviews = tmdbRes.value.results.map(item => {
            let avatarUrl = '';
            const rawPath = item.author_details?.avatar_path;
            if (rawPath) {
                if (rawPath.startsWith('/http')) {
                    avatarUrl = rawPath.substring(1);
                } else if (rawPath.startsWith('http')) {
                    avatarUrl = rawPath;
                } else {
                    avatarUrl = `https://image.tmdb.org/t/p/w185${rawPath}`;
                }
            }

            const ratingVal = (typeof item.author_details?.rating === 'number' && item.author_details.rating > 0)
                ? item.author_details.rating
                : null;

            // Generate deterministic appreciation like count from item id
            const seed = (item.id || 'tmdb').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const likesCount = (Math.abs(seed) % 18) + 2;

            return {
                id: 'tmdb_' + item.id,
                source: 'tmdb',
                sourceLabel: 'TMDB API',
                author: item.author_details?.name || item.author || 'TMDB Reviewer',
                handle: item.author_details?.username ? `@${item.author_details.username}` : '',
                avatar: avatarUrl,
                avatar_type: avatarUrl ? 'image' : 'initials',
                avatar_initials: (item.author || 'TM').slice(0, 2).toUpperCase(),
                rating: ratingVal,
                content: item.content || '',
                has_spoilers: false,
                likes_count: likesCount,
                user_has_liked: false,
                created_at: item.created_at,
                url: item.url
            };
        });
    }

    // Combine reviews (Community first, followed by TMDB Global)
    const allReviews = [...communityReviews, ...tmdbReviews];
    const totalReviews = allReviews.length;

    // Update tab badge count
    const tabBadge = document.getElementById('modalTabReviewCount');
    if (tabBadge) tabBadge.textContent = totalReviews;

    // Calculate aggregate score statistics across all rated reviews
    const ratedReviews = allReviews.filter(r => typeof r.rating === 'number' && r.rating > 0);
    const avgScore = ratedReviews.length
        ? (ratedReviews.reduce((sum, r) => sum + r.rating, 0) / ratedReviews.length).toFixed(1)
        : 'New';

    const highCount = ratedReviews.filter(r => r.rating >= 8).length;
    const midCount = ratedReviews.filter(r => r.rating >= 5 && r.rating < 8).length;
    const lowCount = ratedReviews.filter(r => r.rating < 5).length;
    const totalRated = ratedReviews.length || 1;

    const highPct = ratedReviews.length ? Math.round((highCount / totalRated) * 100) : 0;
    const midPct = ratedReviews.length ? Math.round((midCount / totalRated) * 100) : 0;
    const lowPct = ratedReviews.length ? Math.round((lowCount / totalRated) * 100) : 0;

    container.innerHTML = `
        <div class="community-header">
            <h3><i class="fas fa-comments" style="color:var(--color-primary)"></i> Reviews &amp; Ratings</h3>
            <span style="font-size:.82rem;color:var(--color-text-dim);">${totalReviews} total review${totalReviews === 1 ? '' : 's'}</span>
        </div>

        <div class="community-score-summary">
            <div class="score-big-box">
                <div class="score-big-num">${avgScore}</div>
                <div class="score-big-stars">
                    ${ratedReviews.length ? renderStarIcons(Math.round(parseFloat(avgScore))) : '<span style="font-size:.78rem;color:var(--color-text-dim)">Not rated yet</span>'}
                </div>
                <div class="score-total-count">${ratedReviews.length ? `Combined score from ${ratedReviews.length} ratings` : 'Be the first to rate!'}</div>
            </div>
            <div class="score-breakdown-bars">
                <div class="bar-row">
                    <span>Great (8-10★)</span>
                    <div class="bar-track"><div class="bar-fill" style="width: ${highPct}%; background:#22c55e;"></div></div>
                    <span>${highPct}%</span>
                </div>
                <div class="bar-row">
                    <span>Good (5-7★)</span>
                    <div class="bar-track"><div class="bar-fill" style="width: ${midPct}%; background:#eab308;"></div></div>
                    <span>${midPct}%</span>
                </div>
                <div class="bar-row">
                    <span>Low (1-4★)</span>
                    <div class="bar-track"><div class="bar-fill" style="width: ${lowPct}%; background:#ef4444;"></div></div>
                    <span>${lowPct}%</span>
                </div>
            </div>
        </div>

        <!-- Review Input Form (Post to Community) -->
        <div class="review-form-card">
            <h4><i class="fas fa-pen-nib" style="color:var(--color-primary);margin-right:6px;"></i> Write a Community Review</h4>
            <div class="star-rating-picker-wrapper">
                <div class="star-picker" id="starPicker">
                    ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(val => `
                        <button type="button" class="star-btn" data-val="${val}" aria-label="Rate ${val} stars">
                            <i class="fas fa-star"></i>
                        </button>
                    `).join('')}
                </div>
                <span class="rating-score-label" id="ratingScoreLabel">Pick a rating</span>
            </div>
            <textarea class="review-textarea" id="reviewContentInput" placeholder="What did you think of this film? Share your insights, performance highlights, or favorite moments..." rows="3"></textarea>
            <div class="review-form-footer">
                <label class="spoiler-checkbox-label">
                    <input type="checkbox" id="reviewSpoilerCheckbox">
                    <span>Contains Spoilers ⚠️</span>
                </label>
                <button class="btn-submit-review" id="submitReviewBtn">
                    ${currentUser ? 'Post Review' : '<i class="fas fa-lock" style="margin-right:6px"></i> Sign In to Review'}
                </button>
            </div>
        </div>

        <!-- Review Filter Tabs -->
        <div class="review-filter-bar">
            <div class="review-filter-pills" id="reviewFilterPills">
                <button type="button" class="review-filter-pill active" data-filter="all">
                    <i class="fas fa-layer-group"></i> All Reviews <span class="review-filter-count">${totalReviews}</span>
                </button>
                <button type="button" class="review-filter-pill" data-filter="doomovie">
                    <i class="fas fa-crown" style="color:#ff6b6b"></i> DooMovie Community <span class="review-filter-count">${communityReviews.length}</span>
                </button>
                <button type="button" class="review-filter-pill" data-filter="tmdb">
                    <i class="fas fa-globe" style="color:#01b4e4"></i> TMDB API Reviews <span class="review-filter-count">${tmdbReviews.length}</span>
                </button>
            </div>
            <span style="font-size:.78rem;color:var(--color-text-dim)">Showing <span id="reviewShowingCount">${totalReviews}</span> reviews</span>
        </div>

        <!-- Reviews Feed -->
        <div class="reviews-list" id="reviewsList">
            ${allReviews.length ? allReviews.map(r => renderReviewItemHTML(r)).join('') : `
                <div style="text-align:center;padding:36px 20px;color:var(--color-text-dim);background:rgba(255,255,255,0.02);border-radius:var(--radius-md);border:1px dashed var(--color-border);">
                    <i class="fas fa-comment-dots" style="font-size:2.2rem;margin-bottom:12px;display:block;opacity:0.6;"></i>
                    No written reviews found yet for "${escapeHtml(movieTitle || 'this movie')}". Be the first to share your review above!
                </div>
            `}
        </div>
    `;

    // Filter pill interactivity
    const filterPills = container.querySelectorAll('.review-filter-pill');
    const reviewItems = container.querySelectorAll('.review-item-card');
    const countDisplay = container.querySelector('#reviewShowingCount');

    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const targetFilter = pill.dataset.filter;
            let visibleCount = 0;

            reviewItems.forEach(item => {
                const itemSource = item.dataset.source;
                const show = targetFilter === 'all' || itemSource === targetFilter;
                item.style.display = show ? 'block' : 'none';
                if (show) visibleCount++;
            });

            if (countDisplay) countDisplay.textContent = visibleCount;
        });
    });

    // Read More toggle for lengthy reviews
    container.querySelectorAll('.btn-read-more').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = btn.closest('.review-item-card');
            const preview = card.querySelector('.review-text-preview');
            const full = card.querySelector('.review-text-full');
            const isExpanded = full.style.display === 'block';

            if (isExpanded) {
                full.style.display = 'none';
                preview.style.display = 'block';
                btn.innerHTML = 'Read More <i class="fas fa-chevron-down"></i>';
            } else {
                full.style.display = 'block';
                preview.style.display = 'none';
                btn.innerHTML = 'Show Less <i class="fas fa-chevron-up"></i>';
            }
        });
    });

    // Star Picker interactions
    let selectedRating = 0;
    const ratingLabels = {
        1: '1/10 — Unwatchable 🤮',
        2: '2/10 — Terrible 👎',
        3: '3/10 — Bad 🙁',
        4: '4/10 — Poor 😕',
        5: '5/10 — Mediocre 😐',
        6: '6/10 — Okay 🙂',
        7: '7/10 — Good 👍',
        8: '8/10 — Very Good ✨',
        9: '9/10 — Outstanding 🔥',
        10: '10/10 — Masterpiece 👑'
    };

    const starBtns = container.querySelectorAll('.star-btn');
    const scoreLabel = container.querySelector('#ratingScoreLabel');

    const highlightStars = (count) => {
        starBtns.forEach(btn => {
            const val = parseInt(btn.dataset.val, 10);
            btn.classList.toggle('hovered', val <= count);
        });
        if (count > 0 && ratingLabels[count]) {
            if (scoreLabel) scoreLabel.textContent = ratingLabels[count];
        } else if (selectedRating > 0) {
            if (scoreLabel) scoreLabel.textContent = ratingLabels[selectedRating];
        } else {
            if (scoreLabel) scoreLabel.textContent = 'Pick a rating';
        }
    };

    starBtns.forEach(btn => {
        btn.addEventListener('mouseenter', () => highlightStars(parseInt(btn.dataset.val, 10)));
        btn.addEventListener('mouseleave', () => highlightStars(0));
        btn.addEventListener('click', () => {
            selectedRating = parseInt(btn.dataset.val, 10);
            starBtns.forEach(b => {
                const val = parseInt(b.dataset.val, 10);
                b.classList.toggle('selected', val <= selectedRating);
            });
            if (scoreLabel) scoreLabel.textContent = ratingLabels[selectedRating];
        });
    });

    // Review Submission
    const submitBtn = container.querySelector('#submitReviewBtn');
    submitBtn?.addEventListener('click', async () => {
        if (!currentUser || !authToken) {
            openAuthModal('login', 'Please sign in to write a review and rate movies');
            return;
        }

        if (!selectedRating) {
            showToast('Please select a star rating (1-10) before submitting', 'error');
            return;
        }

        const content = container.querySelector('#reviewContentInput')?.value || '';
        if (content.trim().length < 5) {
            showToast('Please write at least 5 characters in your review', 'error');
            return;
        }

        const hasSpoilers = container.querySelector('#reviewSpoilerCheckbox')?.checked || false;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Posting...';

        try {
            await apiFetch(`/api/movies/${movieId}/reviews`, {
                method: 'POST',
                body: JSON.stringify({
                    rating: selectedRating,
                    content: content.trim(),
                    hasSpoilers
                })
            });

            showToast('Your review has been published! 🎉', 'success');
            loadMovieReviews(movieId, movieTitle);
        } catch (err) {
            // Save to local storage as resilient fallback
            const localKey = `doomovie_reviews_${movieId}`;
            const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
            existing.unshift({
                id: 'local_' + Date.now(),
                movie_id: movieId,
                username: currentUser?.username || 'You',
                avatar: currentUser?.avatar || '🍿',
                rating: selectedRating,
                content: content.trim(),
                has_spoilers: hasSpoilers ? 1 : 0,
                likes_count: 0,
                created_at: new Date().toISOString()
            });
            localStorage.setItem(localKey, JSON.stringify(existing));
            showToast('Review tersimpan di profil! 🎉', 'success');
            loadMovieReviews(movieId, movieTitle);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Post Review';
        }
    });

    // Bind Spoiler reveal buttons
    container.querySelectorAll('.spoiler-mask').forEach(mask => {
        mask.addEventListener('click', () => {
            const target = mask.nextElementSibling;
            if (target) {
                mask.style.display = 'none';
                target.classList.add('revealed');
            }
        });
    });

    // Bind Like buttons
    container.querySelectorAll('.btn-review-like').forEach(likeBtn => {
        likeBtn.addEventListener('click', async () => {
            const source = likeBtn.dataset.source;
            const reviewId = likeBtn.dataset.reviewId;
            const countSpan = likeBtn.querySelector('.like-count');

            if (source === 'doomovie') {
                if (!currentUser || !authToken) {
                    openAuthModal('login', 'Please sign in to like reviews');
                    return;
                }
                try {
                    const result = await apiFetch(`/api/reviews/${reviewId}/like`, { method: 'POST' });
                    likeBtn.classList.toggle('liked', result.liked);
                    let count = parseInt(countSpan.textContent, 10) || 0;
                    countSpan.textContent = result.liked ? count + 1 : Math.max(0, count - 1);
                } catch (e) {
                    likeBtn.classList.toggle('liked');
                    let count = parseInt(countSpan.textContent, 10) || 0;
                    countSpan.textContent = likeBtn.classList.contains('liked') ? count + 1 : Math.max(0, count - 1);
                }
            } else {
                // TMDB review like toggle locally
                likeBtn.classList.toggle('liked');
                let count = parseInt(countSpan.textContent, 10) || 0;
                countSpan.textContent = likeBtn.classList.contains('liked') ? count + 1 : Math.max(0, count - 1);
                showToast(likeBtn.classList.contains('liked') ? 'Marked review as helpful 👍' : 'Removed reaction', 'info');
            }
        });
    });
}

function renderStarIcons(count) {
    let stars = '';
    for (let i = 1; i <= 10; i++) {
        if (i <= count) stars += '<i class="fas fa-star"></i>';
        else stars += '<i class="far fa-star" style="opacity:0.3"></i>';
    }
    return stars;
}

function renderReviewItemHTML(r) {
    const postDate = r.created_at ? new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recent';
    const isLiked = r.user_has_liked ? 'liked' : '';
    const isTMDB = r.source === 'tmdb';

    // Avatar rendering
    let avatarHTML = '';
    if (r.avatar_type === 'image') {
        avatarHTML = `
            <div class="review-author-avatar-wrapper">
                <img src="${r.avatar}" class="review-avatar-img" alt="${escapeHtml(r.author)}" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'review-avatar-initials\\'>${escapeHtml(r.avatar_initials)}</div>';">
            </div>
        `;
    } else if (r.avatar_type === 'initials') {
        avatarHTML = `
            <div class="review-author-avatar-wrapper">
                <div class="review-avatar-initials">${escapeHtml(r.avatar_initials)}</div>
            </div>
        `;
    } else {
        avatarHTML = `
            <div class="review-author-avatar-wrapper" style="font-size:1.15rem">
                ${r.avatar || '🍿'}
            </div>
        `;
    }

    // Rating badge
    const ratingHTML = (typeof r.rating === 'number' && r.rating > 0)
        ? `<div class="review-badge-rating"><i class="fas fa-star"></i> ${r.rating}/10</div>`
        : `<div class="review-badge-rating unrated"><i class="far fa-star"></i> Unrated</div>`;

    // Source tag
    const sourceBadgeHTML = isTMDB
        ? `<span class="review-source-tag badge-tmdb"><i class="fas fa-globe"></i> TMDB API</span>`
        : `<span class="review-source-tag badge-doomovie"><i class="fas fa-crown"></i> DooMovie</span>`;

    // Content formatting & truncation
    const rawContent = r.content || '';
    const isLong = rawContent.length > 320;
    const contentHTML = isLong
        ? `
            <div class="review-text-preview">${escapeHtml(rawContent.slice(0, 300))}...</div>
            <div class="review-text-full" style="display:none;white-space:pre-line;">${escapeHtml(rawContent)}</div>
            <button type="button" class="btn-read-more">Read More <i class="fas fa-chevron-down"></i></button>
          `
        : `<div style="white-space:pre-line;">${escapeHtml(rawContent)}</div>`;

    return `
        <div class="review-item-card" id="review_${r.id}" data-source="${r.source}">
            <div class="review-item-header">
                <div class="review-author-info">
                    ${avatarHTML}
                    <div>
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <span class="review-author-name">${escapeHtml(r.author)}</span>
                            ${r.handle ? `<span class="review-author-handle">${escapeHtml(r.handle)}</span>` : ''}
                            ${sourceBadgeHTML}
                        </div>
                        <div class="review-post-date">${postDate}</div>
                    </div>
                </div>
                ${ratingHTML}
            </div>
            <div class="review-item-body">
                ${r.has_spoilers ? `
                    <div class="spoiler-mask">
                        <i class="fas fa-shield-alt" style="margin-right:6px"></i> <strong>Spoiler Warning:</strong> Click to view this review
                    </div>
                    <div class="spoiler-content">
                        ${contentHTML}
                    </div>
                ` : contentHTML}
            </div>
            <div class="review-item-footer">
                <div>
                    ${r.url ? `
                        <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="review-tmdb-link">
                            <i class="fas fa-external-link-alt"></i> Baca di TMDB
                        </a>
                    ` : ''}
                </div>
                <div class="review-item-footer-actions">
                    <button type="button" class="btn-review-like ${isLiked}" data-review-id="${r.id}" data-source="${r.source}">
                        <i class="fas fa-heart"></i>
                        <span class="like-count">${r.likes_count || 0}</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

