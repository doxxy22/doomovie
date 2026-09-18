# ==========================================
# DooMovie — Production Dockerfile
# Multi-stage build for optimal image size & security
# ==========================================

# Stage 1: Build & Dependencies
FROM node:22-alpine AS dependencies
WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Stage 2: Final Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8090

# Create application user for security (non-root)
RUN addgroup -S doomovie && adduser -S doomovie -G doomovie

# Create data directory for persistent SQLite storage
RUN mkdir -p /app/data && chown -R doomovie:doomovie /app/data

# Copy installed node_modules from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./

# Copy application source code
COPY server/ ./server/
COPY index.html ./
COPY script.js ./
COPY styles.css ./
COPY manifest.json ./
COPY sw.js ./
COPY doomovie.png ./
COPY .env.example ./.env.example

# Set correct ownership
RUN chown -R doomovie:doomovie /app

# Switch to non-root user
USER doomovie

# Expose default port
EXPOSE 8090

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8090/api/tmdb/trending/movie/day || exit 1

# Start the application
CMD ["node", "server/server.js"]
