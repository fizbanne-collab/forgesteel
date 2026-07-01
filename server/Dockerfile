FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
RUN npm run build:api

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations

USER node
CMD ["sh", "-c", "node server/dist/migrate.js && node server/dist/index.js"]
