# node:sqlite needs Node 22.13+ (unflagged); pinned to the version this was built and tested on.
FROM node:22.22.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22.22.2-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json findings.json ./
COPY data ./data
COPY server ./server
COPY shared ./shared
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
