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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_movie ON reviews(movie_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_list_items_user ON list_items(user_id, movie_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Phase 5: Freemium Subscriptions (DooMovie Pro / Stripe)
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id INTEGER PRIMARY KEY,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT DEFAULT 'pro',
    status TEXT DEFAULT 'active',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Phase 5: Affiliate Link Tracking
CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    provider TEXT NOT NULL,
    movie_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Phase 5: Movie Journey Timeline
CREATE TABLE IF NOT EXISTS movie_journey (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    movie_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster_path TEXT,
    rating INTEGER DEFAULT 0,
    mood TEXT DEFAULT 'entertained',
    notes TEXT DEFAULT '',
    watched_date DATE DEFAULT (CURRENT_DATE),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Phase 5: Cinephile Challenge Mode
CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT DEFAULT '🏆',
    target_count INTEGER NOT NULL,
    category TEXT DEFAULT 'general',
    badge_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_challenges (
    user_id INTEGER NOT NULL,
    challenge_id TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    is_completed INTEGER DEFAULT 0,
    completed_at DATETIME,
    PRIMARY KEY (user_id, challenge_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

-- Phase 5: Performance Web Vitals Telemetry
CREATE TABLE IF NOT EXISTS telemetry_vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    rating TEXT NOT NULL,
    url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: add role and tier columns to users if missing
try {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';");
} catch (e) { /* column exists */ }
try {
    db.exec("ALTER TABLE users ADD COLUMN tier TEXT DEFAULT 'free';");
} catch (e) { /* column exists */ }

// Seed default Cinephile Challenges
(function seedChallenges() {
    const count = db.prepare('SELECT COUNT(*) as count FROM challenges').get().count;
    if (count === 0) {
        const insert = db.prepare('INSERT INTO challenges (id, title, description, icon, target_count, category, badge_name) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insert.run('ch_indo_cinema', 'Indonesian Cinema Champion', 'Explore and rate 3 Indonesian masterworks', '🇮🇩', 3, 'indonesian', 'Garuda Cinephile 🦅');
        insert.run('ch_sci_fi', 'Mind-Blowing Odyssey', 'Watch and review 5 Sci-Fi or Mystery movies', '🚀', 5, 'scifi', 'Cosmic Thinker 🌌');
        insert.run('ch_critic', 'Voice of the Crowd', 'Write 5 detailed movie reviews with star ratings', '✍️', 5, 'reviews', 'Grand Critic 👑');
        insert.run('ch_curator', 'Master Curator', 'Create 3 custom movie watchlists with icons', '📋', 3, 'curation', 'Elite Curator ✨');
        insert.run('ch_weekend', 'Weekend Binge Master', 'Log 4 movies in your Movie Journey timeline', '🍿', 4, 'journey', 'Weekend Binger 🎬');
    }
})();

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
        const stmt = db.prepare('SELECT id, username, email, avatar, bio, role, tier, created_at FROM users WHERE id = ?');
        const user = stmt.get(id);
        if (!user) return null;
        // Check active subscription
        const sub = db.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active'").get(id);
        if (sub) user.tier = 'pro';
        // Give admin role to first user, email admin, or designated admin user
        if (user.id === 1 || user.id === 4 || user.username === 'doobaby' || user.email.includes('admin') || user.role === 'admin') {
            user.role = 'admin';
        }
        return user;
    },
    create: (username, email, passwordHash, avatar = '🍿') => {
        const stmt = db.prepare("INSERT INTO users (username, email, password_hash, avatar, role, tier) VALUES (?, ?, ?, ?, 'user', 'free')");
        const result = stmt.run(username.trim(), email.toLowerCase().trim(), passwordHash, avatar);
        const newId = Number(result.lastInsertRowid);
        // First user is automatically admin
        if (newId === 1) {
            db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(newId);
        }
        return {
            id: newId,
            username: username.trim(),
            email: email.toLowerCase().trim(),
            avatar,
            role: newId === 1 ? 'admin' : 'user',
            tier: 'free'
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
        const journeyCount = db.prepare('SELECT COUNT(*) as count FROM movie_journey WHERE user_id = ?').get(userId);
        const completedChallenges = db.prepare('SELECT COUNT(*) as count FROM user_challenges WHERE user_id = ? AND is_completed = 1').get(userId);
        return {
            listsCount: listsCount ? listsCount.count : 0,
            savedMoviesCount: savedMoviesCount ? savedMoviesCount.count : 0,
            reviewsCount: reviewsCount ? reviewsCount.count : 0,
            avgRating: avgRating && avgRating.avg ? Number(avgRating.avg.toFixed(1)) : null,
            journeyCount: journeyCount ? journeyCount.count : 0,
            completedChallenges: completedChallenges ? completedChallenges.count : 0
        };
    },
    // GDPR Data Export
    exportUserData: (userId) => {
        const user = userQueries.findById(userId);
        if (!user) return null;
        const lists = listQueries.getUserLists(userId);
        const reviews = db.prepare('SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC').all(userId);
        const journey = db.prepare('SELECT * FROM movie_journey WHERE user_id = ? ORDER BY watched_date DESC').all(userId);
        const challenges = db.prepare(`
            SELECT c.title, c.badge_name, uc.progress, uc.is_completed, uc.completed_at 
            FROM user_challenges uc 
            JOIN challenges c ON uc.challenge_id = c.id 
            WHERE uc.user_id = ?
        `).all(userId);

        return {
            exportDate: new Date().toISOString(),
            platform: 'DooMovie Cinephile Experience',
            gdprComplianceVersion: '2.0-2026',
            userProfile: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                bio: user.bio,
                tier: user.tier,
                createdAt: user.created_at
            },
            watchlists: lists,
            reviews,
            movieJourneyTimeline: journey,
            unlockedChallenges: challenges
        };
    },
    // GDPR Right to Deletion (Cascade delete)
    deleteUserData: (userId) => {
        db.exec('BEGIN TRANSACTION;');
        try {
            db.prepare('DELETE FROM review_likes WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM reviews WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM list_items WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM lists WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM movie_journey WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM user_challenges WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(userId);
            db.prepare('DELETE FROM users WHERE id = ?').run(userId);
            db.exec('COMMIT;');
            return true;
        } catch (e) {
            db.exec('ROLLBACK;');
            throw e;
        }
    }
};

const listQueries = {
    getUserLists: (userId) => {
        const lists = db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY created_at ASC').all(userId);
        const getItems = db.prepare('SELECT movie_id, title, poster_path, vote_average, release_date, genres, added_at FROM list_items WHERE user_id = ? AND list_id = ?');

        return lists.map(list => {
            const items = getItems.all(userId, list.id);
            return {
                id: list.id,
                name: list.name,
                icon: list.icon,
                created_at: list.created_at,
                movies: items.map(it => it.movie_id),
                movieDetails: items
            };
        });
    },
    createList: (id, userId, name, icon = '📋') => {
        const stmt = db.prepare('INSERT INTO lists (id, user_id, name, icon) VALUES (?, ?, ?, ?)');
        stmt.run(id, userId, name, icon);
        challengeQueries.incrementProgress(userId, 'ch_curator', 1);
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

        const genreArr = typeof movie === 'object' && movie.genre_ids ? movie.genre_ids : [];
        if (genreArr.includes(878) || genreArr.includes(9648)) { // Sci-Fi or Mystery
            challengeQueries.incrementProgress(userId, 'ch_sci_fi', 1);
        }
    },
    removeMovieFromList: (userId, listId, movieId) => {
        const stmt = db.prepare('DELETE FROM list_items WHERE user_id = ? AND list_id = ? AND movie_id = ?');
        stmt.run(userId, listId, parseInt(movieId, 10) || 0);
    },
    saveUserLists: (userId, listsData) => {
        db.exec('BEGIN TRANSACTION;');
        try {
            const deleteItems = db.prepare('DELETE FROM list_items WHERE user_id = ?');
            const deleteLists = db.prepare('DELETE FROM lists WHERE user_id = ?');
            deleteItems.run(userId);
            deleteLists.run(userId);

            const insertList = db.prepare('INSERT INTO lists (id, user_id, name, icon) VALUES (?, ?, ?, ?)');
            const insertItem = db.prepare(`
                INSERT INTO list_items (user_id, list_id, movie_id, title, poster_path, vote_average, release_date, genres)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const l of listsData) {
                const listId = l.id || ('list_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
                const name = l.name || 'My List';
                const icon = l.icon || '📋';
                insertList.run(listId, userId, name, icon);

                if (Array.isArray(l.movies)) {
                    for (const m of l.movies) {
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
    },
    syncAllLists: (userId, listsArray) => {
        return listQueries.saveUserLists(userId, listsArray);
    }
};

const reviewQueries = {
    getByMovieId: (movieId, currentUserId = null) => {
        const stmt = db.prepare(`
            SELECT r.*, u.username, u.avatar, u.tier,
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
        
        // Trigger challenge progression for review
        challengeQueries.incrementProgress(userId, 'ch_critic', 1);

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

// Phase 5: Movie Journey Timeline Queries
const journeyQueries = {
    getUserJourney: (userId) => {
        return db.prepare('SELECT * FROM movie_journey WHERE user_id = ? ORDER BY watched_date DESC, created_at DESC').all(userId);
    },
    addEntry: (userId, movieId, title, posterPath, rating, mood = 'entertained', notes = '', watchedDate = null) => {
        const stmt = db.prepare(`
            INSERT INTO movie_journey (user_id, movie_id, title, poster_path, rating, mood, notes, watched_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE))
        `);
        const res = stmt.run(userId, movieId, title, posterPath || '', rating || 0, mood, notes, watchedDate);
        challengeQueries.incrementProgress(userId, 'ch_weekend', 1);
        return Number(res.lastInsertRowid);
    }
};

// Phase 5: Cinephile Challenges Queries
const challengeQueries = {
    getAllWithUserStatus: (userId) => {
        const challenges = db.prepare('SELECT * FROM challenges').all();
        const userProgress = db.prepare('SELECT * FROM user_challenges WHERE user_id = ?').all(userId);
        const map = new Map(userProgress.map(up => [up.challenge_id, up]));

        return challenges.map(ch => {
            const up = map.get(ch.id) || { progress: 0, is_completed: 0, completed_at: null };
            return {
                ...ch,
                progress: up.progress,
                is_completed: !!up.is_completed,
                completed_at: up.completed_at,
                pct: Math.min(100, Math.round((up.progress / ch.target_count) * 100))
            };
        });
    },
    incrementProgress: (userId, challengeId, amount = 1) => {
        const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
        if (!challenge) return;

        const current = db.prepare('SELECT * FROM user_challenges WHERE user_id = ? AND challenge_id = ?').get(userId, challengeId);
        let newProgress = (current ? current.progress : 0) + amount;
        let isCompleted = newProgress >= challenge.target_count ? 1 : 0;
        let completedAt = isCompleted ? new Date().toISOString() : null;

        if (current) {
            db.prepare(`
                UPDATE user_challenges 
                SET progress = ?, is_completed = ?, completed_at = COALESCE(completed_at, ?)
                WHERE user_id = ? AND challenge_id = ?
            `).run(newProgress, isCompleted, completedAt, userId, challengeId);
        } else {
            db.prepare(`
                INSERT INTO user_challenges (user_id, challenge_id, progress, is_completed, completed_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(userId, challengeId, newProgress, isCompleted, completedAt);
        }
    }
};

// Phase 5: Affiliate & Subscriptions Queries
const affiliateQueries = {
    logClick: (userId, provider, movieId) => {
        const stmt = db.prepare('INSERT INTO affiliate_clicks (user_id, provider, movie_id) VALUES (?, ?, ?)');
        stmt.run(userId || 0, provider, movieId);
    },
    getStats: () => {
        const totalClicks = db.prepare('SELECT COUNT(*) as count FROM affiliate_clicks').get().count;
        const byProvider = db.prepare('SELECT provider, COUNT(*) as clicks FROM affiliate_clicks GROUP BY provider ORDER BY clicks DESC').all();
        return { totalClicks, byProvider };
    }
};

const subscriptionQueries = {
    upgradeToPro: (userId, stripeCustomerId = 'cus_mock', stripeSubId = 'sub_mock') => {
        const stmt = db.prepare(`
            INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, expires_at)
            VALUES (?, ?, ?, 'pro', 'active', datetime('now', '+30 days'))
            ON CONFLICT(user_id) DO UPDATE SET 
                status = 'active', 
                expires_at = datetime('now', '+30 days')
        `);
        stmt.run(userId, stripeCustomerId, stripeSubId);
        db.prepare("UPDATE users SET tier = 'pro' WHERE id = ?").run(userId);
        return { success: true, tier: 'pro' };
    },
    getStatus: (userId) => {
        return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
    }
};

// Phase 5: Admin Panel Operations
const adminQueries = {
    getOverviewStats: () => {
        const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
        const proUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE tier = 'pro'").get().c;
        const totalReviews = db.prepare('SELECT COUNT(*) as c FROM reviews').get().c;
        const totalLists = db.prepare('SELECT COUNT(*) as c FROM lists').get().c;
        const totalAffiliateClicks = db.prepare('SELECT COUNT(*) as c FROM affiliate_clicks').get().c;
        const recentVitals = db.prepare('SELECT metric_name, AVG(metric_value) as avg_val FROM telemetry_vitals GROUP BY metric_name').all();

        return {
            totalUsers,
            proUsers,
            totalReviews,
            totalLists,
            totalAffiliateClicks,
            estimatedMonthlyRevenueUSD: (proUsers * 4.99).toFixed(2),
            webVitalsSummary: recentVitals
        };
    },
    getAllUsers: () => {
        return db.prepare(`
            SELECT u.id, u.username, u.email, u.avatar, u.role, u.tier, u.created_at,
            (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as reviews_count,
            (SELECT COUNT(*) FROM lists WHERE user_id = u.id) as lists_count
            FROM users u
            ORDER BY u.id ASC
        `).all();
    },
    toggleBanUser: (userId) => {
        const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
        if (!user) return null;
        const newRole = user.role === 'banned' ? 'user' : 'banned';
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, userId);
        return newRole;
    },
    deleteReview: (reviewId) => {
        db.prepare('DELETE FROM reviews WHERE id = ?').run(reviewId);
        return true;
    }
};

// Phase 5: Telemetry Web Vitals
const telemetryQueries = {
    logVital: (metricName, metricValue, rating, url = '') => {
        const stmt = db.prepare('INSERT INTO telemetry_vitals (metric_name, metric_value, rating, url) VALUES (?, ?, ?, ?)');
        stmt.run(metricName, metricValue, rating, url);
    },
    getAverages: () => {
        return db.prepare(`
            SELECT metric_name, ROUND(AVG(metric_value), 2) as avg_value, 
            COUNT(*) as sample_count 
            FROM telemetry_vitals 
            GROUP BY metric_name
        `).all();
    }
};

module.exports = {
    db,
    userQueries,
    listQueries,
    reviewQueries,
    journeyQueries,
    challengeQueries,
    affiliateQueries,
    subscriptionQueries,
    adminQueries,
    telemetryQueries
};
