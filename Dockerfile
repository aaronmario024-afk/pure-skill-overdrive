FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173
COPY package*.json ./
COPY server ./server
COPY --from=builder /app/dist ./dist
EXPOSE 5173
CMD ["node", "server/host.mjs"]
