# --- build the client pages ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY client ./client
COPY shared ./shared
RUN npm run build

# --- runtime: server + built pages only ---
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY bundled ./bundled
COPY --from=build /app/dist ./dist
RUN mkdir -p data/drawings && chown -R node:node data
USER node
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/drawings > /dev/null || exit 1
CMD ["node_modules/.bin/tsx", "server/index.ts"]
