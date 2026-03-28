FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p uploads covers && chmod 777 uploads covers

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
