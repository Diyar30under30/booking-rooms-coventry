FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY shared ./shared
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "backend/index.mjs"]
