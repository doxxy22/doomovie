const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'doomovie.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Initialize schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar TEXT DEFAULT '🍿',
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lists (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '📋',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    list_id TEXT NOT NULL,
    movie_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster_path TEXT,
    vote_average REAL,
    release_date TEXT,
    genres TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, list_id) REFERENCES lists(user_id, id) ON DELETE CASCADE,
    UNIQUE(user_id, list_id, movie_id)
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
    content TEXT NOT NULL,
    has_spoilers INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_likes (
    user_id INTEGER NOT NULL,
    review_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, review_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);
`);

// Prepared statement helpers
const userQueries = {
    findByEmail: (email) => {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email.toLowerCase().trim());
    },
    findByUsername: (username) => {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
        return stmt.get(username.trim());
    },
    findById: (id) => {
        const stmt = db.prepare('SELECT id, username, email, avatar, bio, created_at FROM users WHERE id = ?');
        return stmt.get(id);
    },
    create: (username, email, passwordHash, avatar = '🍿') => {
        const stmt = db.prepare('INSERT INTO users (username, email, password_hash, avatar) VALUES (?, ?, ?, ?)');
        const result = stmt.run(username.trim(), email.toLowerCase().trim(), passwordHash, avatar);
        return {
            id: Number(result.lastInsertRowid),
            username: username.trim(),
            email: email.toLowerCase().trim(),
            avatar
        };
    },
    updateProfile: (id, avatar, bio) => {
        const stmt = db.prepare('UPDATE users SET avatar = ?, bio = ? WHERE id = ?');
        stmt.run(avatar, bio, id);
        return userQueries.findById(id);
    },
    getUserStats: (userId) => {
        const listsCount = db.prepare('SELECT COUNT(*) as count FROM lists WHERE user_id = ?').get(userId);
        const savedMoviesCount = db.prepare(`
            SELECT COUNT(DISTINCT movie_id) as count 
            FROM list_items 
            WHERE user_id = ?
        `).get(userId);
        const reviewsCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE user_id = ?').get(userId);
        const avgRating = db.prepare('SELECT AVG(rating) as avg FROM reviews WHERE user_id = ?').get(userId);
        return {
            listsCount: listsCount ? listsCount.count : 0,
            savedMoviesCount: savedMoviesCount ? savedMoviesCount.count : 0,
            reviewsCount: reviewsCount ? reviewsCount.count : 0,
            avgRating: avgRating && avgRating.avg ? Number(avgRating.avg.toFixed(1)) : null
        };
    }
};

const listQueries = {
    getUserLists: (userId) => {
        const listsStmt = db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY created_at ASC');
        const lists = listsStmt.all(userId);
        
        const itemsStmt = db.prepare('SELECT * FROM list_items WHERE user_id = ? AND list_id = ? ORDER BY added_at DESC');
        return lists.map(l => {
            const items = itemsStmt.all(userId, l.id);
            return {
                id: l.id,
                name: l.name,
                icon: l.icon,
                created_at: l.created_at,
                movies: items.map(item => ({
                    id: item.movie_id,
                    title: item.title,
                    poster_path: item.poster_path,
                    vote_average: item.vote_average,
                    release_date: item.release_date,
                    genre_ids: item.genres ? JSON.parse(item.genres) : []
                }))
            };
        });
    },
    createList: (id, userId, name, icon = '📋') => {
        const stmt = db.prepare('INSERT INTO lists (id, user_id, name, icon) VALUES (?, ?, ?, ?)');
        stmt.run(id, userId, name, icon);
        return { id, user_id: userId, name, icon, movies: [] };
    },
    deleteList: (id, userId) => {
        const stmt = db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?');
        const res = stmt.run(id, userId);
        return res.changes > 0;
    },
    addMovieToList: (userId, listId, movie) => {
        const movieId = typeof movie === 'object' ? (movie.id || 0) : (parseInt(movie, 10) || 0);
        if (!movieId) return;
        const title = (typeof movie === 'object' && (movie.title || movie.name)) ? (movie.title || movie.name) : `Movie ${movieId}`;
        const poster = (typeof movie === 'object' && movie.poster_path) ? movie.poster_path : null;
        const vote = (typeof movie === 'object' && movie.vote_average) ? movie.vote_average : 0;
        const release = (typeof movie === 'object' && movie.release_date) ? movie.release_date : '';
        const genres = (typeof movie === 'object' && movie.genre_ids) ? JSON.stringify(movie.genre_ids) : '[]';

        const stmt = db.prepare(`
            INSERT OR IGNORE INTO list_items (user_id, list_id, movie_id, title, poster_path, vote_average, release_date, genres)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(userId, listId, movieId, title, poster, vote, release, genres);
    },
    removeMovieFromList: (userId, listId, movieId) => {
        const stmt = db.prepare('DELETE FROM list_items WHERE user_id = ? AND list_id = ? AND movie_id = ?');
        stmt.run(userId, listId, parseInt(movieId, 10) || 0);
    },
    syncAllLists: (userId, listsArray) => {
        // Clear and rebuild user lists transactionally
        db.exec('BEGIN TRANSACTION;');
        try {
            // Delete existing lists and items for user
            db.prepare('DELETE FROM list_items WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM lists WHERE user_id = ?').run(userId);
            
            const insertList = db.prepare('INSERT INTO lists (id, user_id, name, icon) VALUES (?, ?, ?, ?)');
            const insertItem = db.prepare(`
                INSERT INTO list_items (user_id, list_id, movie_id, title, poster_path, vote_average, release_date, genres)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const list of listsArray) {
                const listId = list.id || ('list_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
                insertList.run(listId, userId, list.name || 'My List', list.icon || '📋');
                if (Array.isArray(list.movies)) {
                    for (const m of list.movies) {
                        const movieId = typeof m === 'object' ? (m.id || 0) : (parseInt(m, 10) || 0);
                        if (!movieId) continue;
                        const title = (typeof m === 'object' && (m.title || m.name)) ? (m.title || m.name) : `Movie ${movieId}`;
                        const poster = (typeof m === 'object' && m.poster_path) ? m.poster_path : null;
                        const vote = (typeof m === 'object' && m.vote_average) ? m.vote_average : 0;
                        const release = (typeof m === 'object' && m.release_date) ? m.release_date : '';
                        const genres = (typeof m === 'object' && m.genre_ids) ? JSON.stringify(m.genre_ids) : '[]';

                        insertItem.run(userId, listId, movieId, title, poster, vote, release, genres);
                    }
                }
            }
            db.exec('COMMIT;');
            return listQueries.getUserLists(userId);
        } catch (err) {
            db.exec('ROLLBACK;');
            throw err;
        }
    }
};

const reviewQueries = {
    getByMovieId: (movieId, currentUserId = null) => {
        const stmt = db.prepare(`
            SELECT r.*, u.username, u.avatar,
            (SELECT COUNT(*) FROM review_likes WHERE review_id = r.id) AS likes_count,
            EXISTS(SELECT 1 FROM review_likes WHERE review_id = r.id AND user_id = ?) AS user_has_liked
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.movie_id = ?
            ORDER BY r.created_at DESC
        `);
        return stmt.all(currentUserId || 0, movieId);
    },
    getMovieStats: (movieId) => {
        const stmt = db.prepare(`
            SELECT 
                COUNT(*) as total_reviews,
                AVG(rating) as avg_rating,
                SUM(CASE WHEN rating >= 8 THEN 1 ELSE 0 END) as count_high,
                SUM(CASE WHEN rating >= 5 AND rating < 8 THEN 1 ELSE 0 END) as count_mid,
                SUM(CASE WHEN rating < 5 THEN 1 ELSE 0 END) as count_low
            FROM reviews 
            WHERE movie_id = ?
        `);
        const stats = stmt.get(movieId);
        return {
            total: stats ? stats.total_reviews : 0,
            avg: stats && stats.avg_rating ? Number(stats.avg_rating.toFixed(1)) : null,
            distribution: {
                high: stats ? stats.count_high : 0,
                mid: stats ? stats.count_mid : 0,
                low: stats ? stats.count_low : 0
            }
        };
    },
    addReview: (movieId, userId, rating, content, hasSpoilers = 0) => {
        const stmt = db.prepare(`
            INSERT INTO reviews (movie_id, user_id, rating, content, has_spoilers)
            VALUES (?, ?, ?, ?, ?)
        `);
        const res = stmt.run(movieId, userId, rating, content, hasSpoilers ? 1 : 0);
        return Number(res.lastInsertRowid);
    },
    toggleLike: (reviewId, userId) => {
        const check = db.prepare('SELECT 1 FROM review_likes WHERE user_id = ? AND review_id = ?').get(userId, reviewId);
        if (check) {
            db.prepare('DELETE FROM review_likes WHERE user_id = ? AND review_id = ?').run(userId, reviewId);
            return { liked: false };
        } else {
            db.prepare('INSERT INTO review_likes (user_id, review_id) VALUES (?, ?)').run(userId, reviewId);
            return { liked: true };
        }
    }
};

module.exports = {
    db,
    userQueries,
    listQueries,
    reviewQueries
};
