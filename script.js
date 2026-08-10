// ============================================
// DooMovie — Netflix-Inspired Application Logic
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

// ── State ──
let watchlist = JSON.parse(localStorage.getItem('doomovie_watchlist')) || [];
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;
let searchTimeout = null;

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    setupNavbar();
    setupSearch();
    setupGenreChips();
    setupCarouselArrows();
    setupScrollToTop();
    setupMobileMenu();

    // Load data concurrently
    await Promise.all([
        loadHeroBillboard(),
        loadCarousel('trendingRow', '/trending/movie/week'),
        loadCarousel('featuredRow', '/movie/popular'),
        loadCarousel('topRatedRow', '/movie/top_rated'),
        loadCarousel('indonesianRow', '/discover/movie', { with_original_language: 'id' }),
        loadCarousel('upcomingRow', '/movie/upcoming')
    ]);

    // Hide page loader
    const loader = document.getElementById('pageLoader');
    if (loader) {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 600);
    }
}

// ── API Helpers ──
async function fetchAPI(endpoint, params = {}) {
    const qp = new URLSearchParams({ api_key: API_KEY, ...params });
    try {
        const res = await fetch(`${BASE_URL}${endpoint}?${qp}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error('API Error:', err);
        return null;
    }
}

// ── Hero Billboard ──
async function loadHeroBillboard() {
    const data = await fetchAPI('/trending/movie/week');
    if (!data?.results) return;

    heroSlides = data.results.slice(0, 5);
    const billboard = document.getElementById('heroBillboard');
    const dotsContainer = document.getElementById('heroDots');

    // Create slides
    heroSlides.forEach((movie, i) => {
        const slide = document.createElement('div');
        slide.className = `hero-slide${i === 0 ? ' active' : ''}`;
        slide.innerHTML = `
      <img class="hero-backdrop" src="${IMG}/original${movie.backdrop_path}" alt="${movie.title}" loading="${i === 0 ? 'eager' : 'lazy'}">
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
            <i class="fas fa-${watchlist.includes(movie.id) ? 'check' : 'plus'}"></i> My List
          </button>
        </div>
      </div>
    `;
        billboard.insertBefore(slide, dotsContainer);

        // Create dot
        const dot = document.createElement('button');
        dot.className = `hero-dot${i === 0 ? ' active' : ''}`;
        dot.addEventListener('click', () => goToSlide(i));
        dotsContainer.appendChild(dot);
    });

    // Auto rotate
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

// ── Carousel Loading ──
async function loadCarousel(rowId, endpoint, extraParams = {}) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const data = await fetchAPI(endpoint, extraParams);
    if (!data?.results) return;

    row.innerHTML = '';
    data.results.forEach(movie => {
        if (!movie.poster_path) return;
        row.appendChild(createMovieCard(movie));
    });
}

// ── Movie Card Creation ──
function createMovieCard(movie) {
    const card = document.createElement('div');
    card.className = 'movie-card';

    const year = movie.release_date?.slice(0, 4) || '';
    const rating = movie.vote_average?.toFixed(1) || 'N/A';
    const genres = (movie.genre_ids || []).slice(0, 3).map(id => GENRE_NAMES[id] || '').filter(Boolean);
    const inList = watchlist.includes(movie.id);

    card.innerHTML = `
    <div class="movie-card-img-wrapper">
      <img class="movie-card-poster" src="${IMG}/w500${movie.poster_path}" alt="${movie.title}" loading="lazy">
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
    const inList = watchlist.includes(movieId);
    btn.classList.toggle('in-list', inList);
    btn.querySelector('i').className = `fas fa-${inList ? 'check' : 'plus'}`;
    btn.title = inList ? 'Remove from List' : 'Add to List';
}

// ── Movie Detail Modal ──
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

    const genres = data.genres?.map(g => `<span>${g.name}</span>`).join('') || '';
    const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const cast = data.credits?.cast?.slice(0, 12) || [];
    const year = data.release_date?.slice(0, 4) || '';
    const runtime = data.runtime ? `${Math.floor(data.runtime / 60)}h ${data.runtime % 60}m` : '';
    const inList = watchlist.includes(movieId);

    const castHTML = cast.map(c => `
    <div class="cast-card">
      <img src="${c.profile_path ? `${IMG}/w185${c.profile_path}` : 'https://via.placeholder.com/68x68/333/666?text=?'}" alt="${c.name}">
      <div class="cast-name">${c.name}</div>
      <div class="cast-char">${c.character || ''}</div>
    </div>
  `).join('');

    const similarHTML = (similar?.results || []).filter(m => m.poster_path).slice(0, 10).map(m => `
    <div class="similar-card" onclick="showMovieDetails(${m.id})">
      <img src="${IMG}/w300${m.poster_path}" alt="${m.title}" loading="lazy">
      <p>${m.title}</p>
    </div>
  `).join('');

    body.innerHTML = `
    <div class="modal-hero">
      <img class="modal-backdrop" src="${IMG}/original${data.backdrop_path || data.poster_path}" alt="${data.title}">
      <div class="modal-hero-gradient"></div>
      <div class="modal-hero-info">
        <h2>${data.title}</h2>
        <div class="modal-hero-buttons">
          ${trailer ? `<button class="btn-hero btn-hero-play" onclick="document.getElementById('modalTrailer').scrollIntoView({behavior:'smooth'})"><i class="fas fa-play"></i> Play Trailer</button>` : ''}
          <button class="btn-hero btn-hero-list" id="modalListBtn" onclick="toggleWatchlist(${movieId}, '${data.title.replace(/'/g, "\\'")}'); updateModalListButton(${movieId});">
            <i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In My List' : 'My List'}
          </button>
        </div>
      </div>
    </div>
    <div class="modal-body-content">
      <div class="modal-meta-row">
        <span class="meta-match">${Math.floor(Math.random() * 12 + 88)}% Match</span>
        <span class="meta-year">${year}</span>
        ${runtime ? `<span class="meta-runtime">${runtime}</span>` : ''}
        <span class="meta-rating-badge"><i class="fas fa-star" style="color:#ffd700;margin-right:4px;"></i>${data.vote_average.toFixed(1)}</span>
      </div>
      <p class="modal-overview">${data.overview || 'No overview available.'}</p>
      <div class="modal-genres">${genres}</div>

      ${cast.length ? `
        <h3 class="modal-section-title">Cast</h3>
        <div class="cast-row">${castHTML}</div>
      ` : ''}

      ${trailer ? `
        <div class="modal-trailer" id="modalTrailer">
          <h3 class="modal-section-title">Trailer</h3>
          <iframe src="https://www.youtube.com/embed/${trailer.key}" allowfullscreen loading="lazy"></iframe>
        </div>
      ` : ''}

      ${similarHTML ? `
        <h3 class="modal-section-title" style="margin-top:28px;">More Like This</h3>
        <div class="similar-row">${similarHTML}</div>
      ` : ''}
    </div>
  `;
}

function updateModalListButton(movieId) {
    const btn = document.getElementById('modalListBtn');
    if (!btn) return;
    const inList = watchlist.includes(movieId);
    btn.innerHTML = `<i class="fas fa-${inList ? 'check' : 'plus'}"></i> ${inList ? 'In My List' : 'My List'}`;
}

function closeMovieModal() {
    const modal = document.getElementById('movieModal');
    modal.classList.remove('visible');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    // Stop any playing trailer
    const iframe = modal.querySelector('iframe');
    if (iframe) iframe.src = '';
}

// ── Watchlist ──
function toggleWatchlist(movieId, title = '') {
    const idx = watchlist.indexOf(movieId);
    if (idx === -1) {
        watchlist.push(movieId);
        showToast(`Added "${title || 'Movie'}" to My List`, 'success');
    } else {
        watchlist.splice(idx, 1);
        showToast(`Removed "${title || 'Movie'}" from My List`, 'info');
    }
    localStorage.setItem('doomovie_watchlist', JSON.stringify(watchlist));
    refreshMyList();
    updateHeroBillboardListButtons();
}

async function refreshMyList() {
    const row = document.getElementById('myListRow');
    const emptyState = document.getElementById('myListEmpty');
    if (!row) return;

    if (watchlist.length === 0) {
        row.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.id = 'myListEmpty';
        empty.innerHTML = `
      <i class="fas fa-bookmark"></i>
      <h3>Your list is empty</h3>
      <p>Add movies to your list by clicking the + button on any movie card.</p>
    `;
        row.appendChild(empty);
        return;
    }

    row.innerHTML = '';
    // Fetch each movie's details
    const promises = watchlist.map(id => fetchAPI(`/movie/${id}`));
    const movies = await Promise.all(promises);
    movies.forEach(movie => {
        if (movie && movie.poster_path) {
            // Convert to card-compatible format
            movie.genre_ids = movie.genres?.map(g => g.id) || [];
            row.appendChild(createMovieCard(movie));
        }
    });
}

function updateHeroBillboardListButtons() {
    document.querySelectorAll('.hero-slide .btn-hero-list').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        const match = onclick.match(/toggleWatchlist\((\d+)/);
        if (match) {
            const id = parseInt(match[1]);
            const inList = watchlist.includes(id);
            btn.querySelector('i').className = `fas fa-${inList ? 'check' : 'plus'}`;
        }
    });
}

// ── Toast Notifications ──
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

// ── Navbar ──
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

            // Update active class
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

// ── Search ──
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

    // ESC to close
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.classList.remove('expanded');
            input.value = '';
            dropdown.classList.remove('visible');
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
      <img src="${movie.poster_path ? `${IMG}/w92${movie.poster_path}` : 'https://via.placeholder.com/44x66/333/666?text=?'}" alt="${movie.title}">
      <div class="search-result-info">
        <h4>${movie.title}</h4>
        <span>${movie.release_date?.slice(0, 4) || 'N/A'} • <i class="fas fa-star" style="color:#ffd700;"></i> ${movie.vote_average?.toFixed(1) || 'N/A'}</span>
      </div>
    </div>
  `).join('');

    dropdown.classList.add('visible');
}

// ── Genre Quick Filters ──
function setupGenreChips() {
    const chips = document.querySelectorAll('.genre-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const genreId = chip.dataset.genre;
            filterByGenre(genreId);
        });
    });
}

async function filterByGenre(genreId) {
    if (!genreId) {
        // Reset — reload all
        await Promise.all([
            loadCarousel('trendingRow', '/trending/movie/week'),
            loadCarousel('featuredRow', '/movie/popular'),
            loadCarousel('topRatedRow', '/movie/top_rated'),
            loadCarousel('indonesianRow', '/discover/movie', { with_original_language: 'id' }),
            loadCarousel('upcomingRow', '/movie/upcoming')
        ]);
        return;
    }

    // Filter all rows by genre
    const params = { with_genres: genreId };
    await Promise.all([
        loadCarousel('trendingRow', '/discover/movie', { ...params, sort_by: 'popularity.desc' }),
        loadCarousel('featuredRow', '/discover/movie', { ...params, sort_by: 'popularity.desc', page: 2 }),
        loadCarousel('topRatedRow', '/discover/movie', { ...params, sort_by: 'vote_average.desc', 'vote_count.gte': 200 }),
        loadCarousel('indonesianRow', '/discover/movie', { ...params, with_original_language: 'id' }),
        loadCarousel('upcomingRow', '/discover/movie', { ...params, 'primary_release_date.gte': new Date().toISOString().slice(0, 10) })
    ]);
}

// ── Carousel Arrow Navigation ──
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

// ── Scroll to Top ──
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

// ── Mobile Menu ──
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

// ── About Modal ──
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
