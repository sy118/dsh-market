# Build the market index service. The context is the repository root so the
# image can take index/ plus its lockfile; nothing else is copied.

FROM node:24-alpine AS deps
WORKDIR /app
COPY index/package.json index/package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY index/package.json ./package.json
COPY index/src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
