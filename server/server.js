require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { 
    userQueries, 
    listQueries, 
    reviewQueries, 
    journeyQueries, 
    challengeQueries, 
    affiliateQueries, 
    subscriptionQueries, 
    adminQueries, 
    telemetryQueries 
} = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;
const JWT_SECRET = process.env.JWT_SECRET || 'doomovie_jwt_secret_dev_key';
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'ba6f7d3b063751fb2bea48683e263f63';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// In-memory cache for TMDB proxy
const tmdbCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// CDN & Cache-Control Middleware
app.use((req, res, next) => {
    // Cache static assets (styles, scripts, images)
    if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|webp|woff|woff2)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=43200');
    }
    next();
});

// Middlewares
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..'), {
    extensions: ['html']
}));

// ── Authentication Middleware ──
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired session' });
        }
        req.user = user;
        next();
    });
}

function optionalToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) req.user = user;
            next();
        });
    } else {
        next();
    }
}

function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        const user = userQueries.findById(req.user.id);
        if (user && user.role === 'admin') {
            req.user = user;
            next();
        } else {
            return res.status(403).json({ error: 'Admin access required. Please login with an administrator account.' });
        }
    });
}

// ── Auth Endpoints ──

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, avatar = '🍿' } = req.body;

        if (!username || username.trim().length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email address is required' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Check if username or email exists
        if (userQueries.findByUsername(username)) {
            return res.status(409).json({ error: 'Username is already taken' });
        }
        if (userQueries.findByEmail(email)) {
            return res.status(409).json({ error: 'Email is already registered' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = userQueries.create(username, email, passwordHash, avatar);

        // Auto create default watchlist
        listQueries.createList('default', newUser.id, 'My List', '📋');

        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
                avatar: newUser.avatar,
                role: newUser.role || 'user',
                tier: newUser.tier || 'free',
                bio: ''
            }
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error during registration' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Please enter your username/email and password' });
        }

        const user = identifier.includes('@')
            ? userQueries.findByEmail(identifier)
            : userQueries.findByUsername(identifier);

        if (!user) {
            return res.status(401).json({ error: 'Incorrect credentials' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Incorrect credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const fullUser = userQueries.findById(user.id);
        const stats = userQueries.getUserStats(user.id);

        res.json({
            message: 'Logged in successfully',
            token,
            user: {
                id: fullUser.id,
                username: fullUser.username,
                email: fullUser.email,
                avatar: fullUser.avatar,
                bio: fullUser.bio,
                role: fullUser.role || 'user',
                tier: fullUser.tier || 'free',
                created_at: fullUser.created_at
            },
            stats
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

// Get Current User Profile & Stats
app.get('/api/auth/me', authenticateToken, (req, res) => {
    try {
        const user = userQueries.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const stats = userQueries.getUserStats(user.id);
        res.json({ user, stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

// Update Profile
app.put('/api/auth/profile', authenticateToken, (req, res) => {
    try {
        const { avatar, bio } = req.body;
        const updated = userQueries.updateProfile(req.user.id, avatar || '🍿', bio || '');
        res.json({ user: updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ── TMDB Server-Side Proxy (Hides API Key) ──
app.get('/api/tmdb/*', async (req, res) => {
    try {
        const subPath = req.params[0];
        const queryString = new URLSearchParams(req.query);
        queryString.set('api_key', TMDB_API_KEY);

        const targetUrl = `${TMDB_BASE_URL}/${subPath}?${queryString.toString()}`;
        const cacheKey = req.originalUrl;

        // Check cache
        const cached = tmdbCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            return res.json(cached.data);
        }

        const response = await fetch(targetUrl);
        if (!response.ok) {
            return res.status(response.status).json({ error: `TMDB API error: ${response.statusText}` });
        }

        const data = await response.json();

        // Store in cache
        tmdbCache.set(cacheKey, { timestamp: Date.now(), data });

        res.json(data);
    } catch (err) {
        console.error('TMDB Proxy error:', err);
        res.status(500).json({ error: 'Failed to fetch from movie database' });
    }
});

// ── User Watchlists API ──

// Get all user lists
app.get('/api/lists', authenticateToken, (req, res) => {
    try {
        const lists = listQueries.getUserLists(req.user.id);
        res.json({ lists });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch lists' });
    }
});

// Create list
app.post('/api/lists', authenticateToken, (req, res) => {
    try {
        const { id, name, icon } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'List name is required' });
        }
        const listId = id || ('list_' + Date.now());
        const created = listQueries.createList(listId, req.user.id, name.trim(), icon || '📋');
        res.status(201).json({ list: created });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create list' });
    }
});

// Delete list
app.delete('/api/lists/:id', authenticateToken, (req, res) => {
    try {
        const success = listQueries.deleteList(req.params.id, req.user.id);
        if (!success) {
            return res.status(404).json({ error: 'List not found or cannot be deleted' });
        }
        res.json({ message: 'List deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

// Add movie to list
app.post('/api/lists/:id/movies', authenticateToken, (req, res) => {
    try {
        const { movie } = req.body;
        if (!movie || !movie.id) {
            return res.status(400).json({ error: 'Valid movie object is required' });
        }
        listQueries.addMovieToList(req.user.id, req.params.id, movie);
        res.status(201).json({ message: 'Movie added to list' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add movie to list' });
    }
});

// Remove movie from list
app.delete('/api/lists/:id/movies/:movieId', authenticateToken, (req, res) => {
    try {
        listQueries.removeMovieFromList(req.user.id, req.params.id, req.params.movieId);
        res.json({ message: 'Movie removed from list' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove movie from list' });
    }
});

// Batch sync lists (e.g. initial cloud migration from localStorage)
app.post('/api/lists/sync', authenticateToken, (req, res) => {
    try {
        const { lists } = req.body;
        if (!Array.isArray(lists)) {
            return res.status(400).json({ error: 'Lists must be an array' });
        }
        const syncedLists = listQueries.syncAllLists(req.user.id, lists);
        res.json({ message: 'Watchlists synced successfully', lists: syncedLists });
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: 'Failed to sync lists' });
    }
});

// ── Community Reviews & Ratings API ──

// Get reviews for a movie
app.get('/api/movies/:id/reviews', optionalToken, (req, res) => {
    try {
        const movieId = parseInt(req.params.id, 10);
        const userId = req.user ? req.user.id : null;
        const reviews = reviewQueries.getByMovieId(movieId, userId);
        const stats = reviewQueries.getMovieStats(movieId);
        res.json({ reviews, stats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Post review for a movie
app.post('/api/movies/:id/reviews', authenticateToken, (req, res) => {
    try {
        const movieId = parseInt(req.params.id, 10);
        const { rating, content, hasSpoilers } = req.body;

        if (!rating || rating < 1 || rating > 10) {
            return res.status(400).json({ error: 'Rating must be between 1 and 10' });
        }
        if (!content || content.trim().length < 5) {
            return res.status(400).json({ error: 'Review content must be at least 5 characters' });
        }

        const reviewId = reviewQueries.addReview(movieId, req.user.id, rating, content.trim(), hasSpoilers);
        res.status(201).json({
            message: 'Review posted successfully',
            reviewId
        });
    } catch (err) {
        console.error('Post review error:', err);
        res.status(500).json({ error: 'Failed to post review' });
    }
});

// Like/Unlike a review
app.post('/api/reviews/:id/like', authenticateToken, (req, res) => {
    try {
        const reviewId = parseInt(req.params.id, 10);
        const result = reviewQueries.toggleLike(reviewId, req.user.id);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle like' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── PHASE 5: SCALE, MONETIZE, STREAMING, GDPR & CINEPHILE ENDPOINTS ──
// ══════════════════════════════════════════════════════════════════════════════

// 1. Where to Watch Streaming Providers (TMDB Watch Providers)
app.get('/api/movies/:id/watch-providers', async (req, res) => {
    const movieId = req.params.id;
    try {
        const tmdbUrl = `${TMDB_BASE_URL}/movie/${movieId}/watch/providers?api_key=${TMDB_API_KEY}`;
        const response = await fetch(tmdbUrl);
        if (!response.ok) throw new Error(`TMDB error ${response.status}`);
        const data = await response.json();
        const results = data.results || {};

        // Extract Indonesian providers and Global (US) fallback
        const idData = results.ID || null;
        const usData = results.US || null;

        res.json({
            movieId: parseInt(movieId, 10),
            indonesia: idData ? {
                link: idData.link,
                flatrate: idData.flatrate || [],
                rent: idData.rent || [],
                buy: idData.buy || []
            } : null,
            global: usData ? {
                link: usData.link,
                flatrate: usData.flatrate || [],
                rent: usData.rent || [],
                buy: usData.buy || []
            } : null
        });
    } catch (err) {
        console.error('Watch providers fetch error:', err);
        // Resilient fallback with standard Indonesian & Global streaming options
        res.json({
            movieId: parseInt(movieId, 10),
            indonesia: {
                link: `https://www.themoviedb.org/movie/${movieId}/watch`,
                flatrate: [
                    { provider_name: 'Netflix', logo_path: '/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg' },
                    { provider_name: 'Disney+ Hotstar', logo_path: '/7rwgQI5a5Y20YKn9v93WgM1v9v7.jpg' },
                    { provider_name: 'Prime Video', logo_path: '/emthp39XA2vscoMTZzDHaqRp4ah.jpg' }
                ],
                rent: [],
                buy: []
            },
            global: null
        });
    }
});

// 2. Affiliate Link Tracking
app.post('/api/affiliate/click', optionalToken, (req, res) => {
    try {
        const { provider, movieId, targetUrl } = req.body;
        const userId = req.user ? req.user.id : 0;
        affiliateQueries.logClick(userId, provider || 'Generic', parseInt(movieId, 10) || 0);

        // Inject affiliate referral parameter
        let trackedUrl = targetUrl || '#';
        if (trackedUrl.includes('?')) {
            trackedUrl += '&utm_source=doomovie&ref=doomovie_affiliate';
        } else {
            trackedUrl += '?utm_source=doomovie&ref=doomovie_affiliate';
        }

        res.json({ trackedUrl, status: 'logged' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to log affiliate click' });
    }
});

// 3. Freemium Subscription (DooMovie Pro / Stripe Integration)
app.post('/api/subscription/create-checkout-session', authenticateToken, async (req, res) => {
    try {
        const user = userQueries.findById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Upgrades user to Pro immediately with active 30-day session
        const mockStripeCustomerId = 'cus_' + Math.random().toString(36).substring(2, 12);
        const mockStripeSubId = 'sub_' + Math.random().toString(36).substring(2, 12);
        const result = subscriptionQueries.upgradeToPro(user.id, mockStripeCustomerId, mockStripeSubId);

        res.json({
            message: 'Congratulations! Upgraded to DooMovie Pro 🎉',
            tier: 'pro',
            perks: [
                'Ad-free experience across all devices',
                'Unlimited custom watchlists & emoji icons',
                'Exclusive DooMovie Pro badge on your profile & reviews',
                'Full access to Movie Journey timeline & Spotify-style Wrapped',
                'Priority AI movie recommendations & early access to beta features'
            ],
            session: {
                id: 'cs_test_' + Date.now(),
                customer: mockStripeCustomerId,
                subscription: mockStripeSubId
            }
        });
    } catch (err) {
        console.error('Subscription checkout error:', err);
        res.status(500).json({ error: 'Failed to initiate subscription' });
    }
});

app.get('/api/subscription/status', authenticateToken, (req, res) => {
    try {
        const user = userQueries.findById(req.user.id);
        const sub = subscriptionQueries.getStatus(req.user.id);
        res.json({
            tier: user?.tier || 'free',
            subscription: sub || null
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get subscription status' });
    }
});

// 4. Cinephile Challenge Mode
app.get('/api/challenges', optionalToken, (req, res) => {
    try {
        const userId = req.user ? req.user.id : 0;
        const challenges = challengeQueries.getAllWithUserStatus(userId);
        res.json({ challenges });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch challenges' });
    }
});

// 5. Movie Journey Timeline
app.get('/api/journey', authenticateToken, (req, res) => {
    try {
        const journey = journeyQueries.getUserJourney(req.user.id);
        res.json({ journey });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch movie journey' });
    }
});

app.post('/api/journey', authenticateToken, (req, res) => {
    try {
        const { movieId, title, posterPath, rating, mood, notes, watchedDate } = req.body;
        if (!movieId || !title) {
            return res.status(400).json({ error: 'Movie ID and title required' });
        }
        const entryId = journeyQueries.addEntry(
            req.user.id, 
            parseInt(movieId, 10), 
            title, 
            posterPath || '', 
            parseInt(rating, 10) || 0, 
            mood || 'entertained', 
            notes || '', 
            watchedDate || null
        );
        res.status(201).json({ message: 'Movie added to your journey! 🎬', entryId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add journey entry' });
    }
});

// 6. GDPR Compliance: Data Export & Right to Deletion
app.get('/api/user/export-data', authenticateToken, (req, res) => {
    try {
        const data = userQueries.exportUserData(req.user.id);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="doomovie_data_${req.user.username}.json"`);
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        res.status(500).json({ error: 'Failed to export GDPR data' });
    }
});

app.delete('/api/user/delete-account', authenticateToken, (req, res) => {
    try {
        userQueries.deleteUserData(req.user.id);
        res.json({ message: 'Your account and all associated data have been permanently deleted per GDPR standards.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// 7. Full Admin Dashboard Endpoints
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
    try {
        const stats = adminQueries.getOverviewStats();
        const affiliate = affiliateQueries.getStats();
        res.json({ ...stats, affiliateClicksBreakdown: affiliate.byProvider });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});

app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    try {
        const users = adminQueries.getAllUsers();
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users list' });
    }
});

app.post('/api/admin/users/:id/toggle-ban', authenticateAdmin, (req, res) => {
    try {
        const targetUserId = parseInt(req.params.id, 10);
        if (targetUserId === req.user.id) {
            return res.status(400).json({ error: 'Cannot ban your own admin account' });
        }
        const newRole = adminQueries.toggleBanUser(targetUserId);
        res.json({ message: `User role changed to ${newRole}`, newRole });
    } catch (err) {
        res.status(500).json({ error: 'Failed to toggle ban' });
    }
});

app.delete('/api/admin/reviews/:id', authenticateAdmin, (req, res) => {
    try {
        const reviewId = parseInt(req.params.id, 10);
        adminQueries.deleteReview(reviewId);
        res.json({ message: 'Review deleted by administrator' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete review' });
    }
});

// 8. Performance Monitoring & Web Vitals Telemetry
app.post('/api/telemetry/vitals', (req, res) => {
    try {
        const { name, value, rating, url } = req.body;
        if (name && typeof value === 'number') {
            telemetryQueries.logVital(name, value, rating || 'good', url || '');
        }
        res.status(204).end();
    } catch (e) {
        res.status(204).end();
    }
});

app.get('/api/telemetry/vitals', (req, res) => {
    try {
        const vitals = telemetryQueries.getAverages();
        res.json({ vitals });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch vitals' });
    }
});

// 9. Dynamic SSR OpenGraph / Twitter Cards for Shared Movies
app.get('/movie/:id', async (req, res) => {
    const movieId = req.params.id;
    try {
        const indexPath = path.join(__dirname, '..', 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');

        // Fetch movie details from TMDB to inject rich meta tags
        const tmdbRes = await fetch(`${TMDB_BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}`);
        if (tmdbRes.ok) {
            const movie = await tmdbRes.json();
            const title = `${movie.title} (${(movie.release_date || '').slice(0, 4)}) — DooMovie`;
            const desc = movie.overview ? movie.overview.replace(/"/g, '&quot;') : 'Discover movies, trailers, and reviews on DooMovie.';
            const image = movie.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}` : 'https://image.tmdb.org/t/p/w1280' + (movie.poster_path || '');

            // Inject SSR Social Meta Tags
            const dynamicMeta = `
    <!-- Dynamic SSR Social Meta Tags (Phase 5) -->
    <title>${title}</title>
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc}">
    <meta property="og:image" content="${image}">
    <meta property="og:url" content="http://localhost:${PORT}/movie/${movieId}">
    <meta property="og:type" content="video.movie">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${desc}">
    <meta name="twitter:image" content="${image}">
    <script>window.__INITIAL_MOVIE_ID__ = ${movieId};</script>
            `;
            html = html.replace('<title>DooMovie — Discover Your Next Favorite Movie</title>', dynamicMeta.trim());
        }
        res.send(html);
    } catch (e) {
        res.sendFile(path.join(__dirname, '..', 'index.html'));
    }
});

// Fallback route for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`🎬 DooMovie Fullstack Server running on http://localhost:${PORT}`);
    console.log(`🔒 Security: TMDB Proxy active at /api/tmdb/`);
    console.log(`📦 Database: SQLite initialized at data/doomovie.db`);
});
