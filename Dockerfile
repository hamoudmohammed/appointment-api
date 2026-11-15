# ==========================================
# Stage 1: Build & Compile TypeScript
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency definitions and TypeScript config
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies required for tsc)
RUN npm ci

# Copy source code and build
COPY src ./src
RUN npm run build

# ==========================================
# Stage 2: Production Runner
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Copy only the compiled JavaScript files and package.json
# Note: Since the core API uses native Node.js HTTP primitives,
# no runtime node_modules are needed in the final production image.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

# Security: Run as non-root user (built-in alpine node user, uid 1000)
USER node

# Expose server port
EXPOSE 3000

# Container Orchestrator Health Check (Docker, Kubernetes, AWS ECS)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Start the compiled production server
CMD ["node", "dist/server.js"]
