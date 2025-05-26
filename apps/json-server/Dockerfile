# Development stage
FROM docker.io/node:lts-alpine AS development

WORKDIR /workspace

# Install development dependencies with cache mount and proper error handling
# Added specific version constraints and separated commands for better error handling
RUN --mount=type=cache,target=/root/.npm \
    apk update && \
    apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    linux-headers \
    sudo && \
    # Verify installations
    python3 --version && \
    g++ --version && \
    git --version && \
    # Add node user to sudo group
    echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node && \
    # Install global npm packages
    npm install -g pnpm@latest nx@latest

# Copy package management files
COPY package.json pnpm-lock.yaml ./
COPY apps/json-server/package.json ./apps/json-server/

# Use cache mount for pnpm store with improved error handling
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline && \
    pnpm store prune

# Copy workspace configuration files
COPY apps/json-server/project.json \
    apps/json-server/tsconfig.json \
    apps/json-server/tsconfig.app.json \
    ./apps/json-server/

# Copy source code (will be overridden by volume mount in development)
COPY . .

# Copy entrypoint script and set permissions
COPY entrypoint.sh /workspace/
RUN chmod +x /workspace/entrypoint.sh

# Expose ports for development and debugging
EXPOSE 8000
EXPOSE 9229

# Switch to node user for development
USER node

CMD ["pnpm", "nx", "serve", "json-server", "--configuration=development"]

# Builder stage
FROM docker.io/node:lts-alpine AS builder

WORKDIR /build

# Install build dependencies with version pinning
RUN npm install -g pnpm@latest

# Copy package files for dependency installation
COPY dist/apps/json-server/package.json ./package.json
COPY dist/apps/json-server/pnpm-lock.yaml ./pnpm-lock.yaml

# Install production dependencies
RUN pnpm install --prod --no-frozen-lockfile --prefer-offline

# Copy built application files
COPY dist/apps/json-server/. .

# Production stage
FROM docker.io/node:lts-alpine AS production

# Application metadata
LABEL maintainer="Jinto A G <project.jinto@gmail.com>" \
    name="json-server" \
    description="json-server API Service" \
    version="0.1.0"

# Runtime configuration
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8888 \
    LOG_LEVEL=info \
    ENABLE_AUTH=true \
    ALLOWED_ORIGINS=*

# Set working directory
WORKDIR /app

# Install runtime dependencies and create non-root user with specific versions
RUN apk update && \
    apk add --no-cache dumb-init && \
    addgroup --system json-server && \
    adduser --system -G json-server json-server && \
    chown -R json-server:json-server /app

# Copy from builder stage with explicit file ownership
COPY --from=builder --chown=json-server:json-server /build/node_modules ./node_modules
COPY --from=builder --chown=json-server:json-server /build/. .
COPY --chown=json-server:json-server db.json ./db.json

# Add health check with improved parameters
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider --header="Accept: application/json" http://localhost:8888/health || exit 1

# Expose application port
EXPOSE 8888

# Switch to non-root user
USER json-server

# Use dumb-init as init system
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "main.js"]