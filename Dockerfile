# API image: docker build -t devhub-api .
# On start it runs pending migrations, then the server. Config comes from env vars (no .env files).

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Toolchain for native modules without a prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
# Migrations run from TypeScript sources via tsx, so dev dependencies stay in the image.
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
