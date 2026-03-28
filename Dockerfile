# A.L.E.C. - Personal AI Companion Docker Image
# Multi-stage build for optimized production image

FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Build frontend (if using Vite)
# RUN npm run build

FROM node:18-alpine

LABEL maintainer="Your Name"
LABEL description="A.L.E.C. - Adaptive Learning Executive Companion"
LABEL version="1.0.0"

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    curl \
    && rm -rf /var/cache/apk/*

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/services ./services
COPY --from=builder /app/frontend ./frontend

# Create necessary directories
RUN mkdir -p data/models logs chat history skills smarthome tokens

# Set permissions
RUN chmod -R 755 /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV JWT_SECRET=your-secret-key-change-in-production
ENV NEURAL_MODEL_PATH=/app/data/models/personal_model.bin

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["node", "backend/server.js"]
