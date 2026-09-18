require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { userQueries, listQueries, reviewQueries } = require('./db');

const app = express();
const PORT = process.env.PORT || 8090;
const JWT_SECRET = process.env.JWT_SECRET || 'doomovie_jwt_secret_dev_key';
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'ba6f7d3b063751fb2bea48683e263f63';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// In-memory cache for TMDB proxy
const tmdbCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

        const stats = userQueries.getUserStats(user.id);

        res.json({
            message: 'Logged in successfully',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                bio: user.bio,
                created_at: user.created_at
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
