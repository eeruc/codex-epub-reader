FROM node:20-slim

WORKDIR /app

# Copy package files and install ALL dependencies (need devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Create data directories with write permissions
RUN mkdir -p uploads covers && chmod 777 uploads covers

# Hugging Face Spaces uses port 7860
EXPOSE 7860

ENV NODE_ENV=production
ENV PORT=7860

CMD ["node", "dist/index.cjs"]
