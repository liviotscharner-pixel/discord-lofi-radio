FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

COPY tsconfig.json stations.json ./
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
