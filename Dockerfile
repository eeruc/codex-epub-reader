FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Create data directories
RUN mkdir -p uploads covers

# Expose port
EXPOSE 10000

# Start production server
ENV NODE_ENV=production
ENV PORT=10000
CMD ["node", "dist/index.cjs"]
