# DevHub API

Backend for DevHub (chat, meetings, presence): Node.js + Express 5, PostgreSQL via Knex, Redis
(ioredis), Socket.IO (`@socket.io/redis-adapter`), JWT auth, argon2. The web app lives in the
separate **devhub-web** repo.

## Getting started

```bash
npm install
docker compose up -d              # Postgres + Redis (+ mailpit)
cp .env.example .env              # then fill in real secrets
npm run db:migrate
npm run db:seed                   # creates admin@devhub.local / ChangeMe123!
npm run dev                       # http://HOST_IP:API_PORT
```

Then start devhub-web. `server.ts` connects to Postgres before it starts listening, so a
misconfigured DB fails fast.

**Local address.** `HOST_IP` (`localhost` or this machine's LAN IP), `WEB_PORT` and `HTTPS` must
match devhub-web's `.env`. The API allows the web app on `localhost` and on `HOST_IP`, and builds
email links from `HOST_IP`. Any `.env` value can reference `${HOST_IP}`, `${API_PORT}` or
`${WEB_PORT}`, e.g. `DATABASE_URL=postgresql://user:pass@${HOST_IP}:5432/devhub`.

## Folder structure

```
src
  config/         env, logger, redis client + cache helpers
  db/             knex connection, factory helpers, migrations, seeds
  models/         one file per table; raw Knex queries + table-specific custom queries
  modules/<name>/ routes -> controller (req/res) -> service (business logic, calls models)
  common/         constants, AppError, middlewares, utils
  websocket/      Socket.IO server, handshake auth, presence/chat/meeting handlers
  shared/         types + constants shared with devhub-web (see below)
  routes/         module router aggregation
  app.ts / server.ts
```

## Shared code (`src/shared`)

Socket event names, roles/permissions, API response types and meeting types. devhub-web has an
identical copy in its `src/shared`. **When you change a file here, copy it to devhub-web too**, or
the two ends drift apart (e.g. a renamed socket event silently stops working). The only difference
between the copies: this one imports with `.js` suffixes (Node ESM), the web one without.

## API gateway & encryption at rest

- **Browsers call the API directly.** CORS allows only `CLIENT_ORIGIN` (plus the local web origins
  in development). Hosted, the refresh cookie is `SameSite=None; Secure` so it works cross-site.
- **Message text, meeting titles and agendas are encrypted in Postgres** with AES-256-GCM using
  `DB_ENCRYPTION_KEY`. **Losing or changing that key makes stored messages unreadable.**

## RBAC, auth & sessions

- `modules/rbac/rbac.service.ts` is the only place roles/permissions are computed (cached in Redis
  for 5 minutes). `common/middlewares/authorize.ts` is the only enforcement point. Role → permission
  grants live in `src/shared/rbac.ts`.
- Login issues a 15-minute JWT access token and a random refresh token, stored hashed and set as an
  `httpOnly` cookie scoped to `/api/auth`. Each device (`x-device-id` header) gets its own session.

## Organizations & invites

Register creates an organization and its owner (`ADMIN`). Invites are single-use tokens (only the
SHA-256 is stored) that expire after `INVITE_TTL_HOURS` (default 72). Without `SMTP_HOST`, dev logs
the email instead of sending it. For local testing: `docker compose up -d mailpit`,
`SMTP_HOST=localhost SMTP_PORT=1025`, read mail at http://localhost:8025. Test SMTP with
`npm run mail:test -- you@example.com`.

## Presence & meetings

- Presence is driven by Socket.IO connect/disconnect (Redis set per user, 8s grace window).
  `in_meeting` is set on join and restored on leave.
- Calls are peer-to-peer WebRTC (mesh, max 12). This server only authorizes and relays signaling.
  Who's in a call = which sockets are in the `meeting:<id>` room. A dropped socket gets 10s grace.
- Optional env: `STUN_URLS`, `TURN_URLS`, `TURN_SECRET` (coturn `use-auth-secret`),
  `TURN_TTL_SECONDS`. Use TURN in production, or callers on different networks often can't connect.

## Responses & security

Every response is `{ success: true, data, meta? }` or `{ success: false, error: { code, message,
details? } }`, produced only by `sendSuccess`/`sendError` and `errorHandler.ts`. Middleware:
`helmet`, `cors` (credentialed, locked to `CLIENT_ORIGIN`), `hpp`, a request sanitizer, Zod
validation per route, Redis-backed rate limits.

## Deploying

Vercel can't run this server: it needs long-lived Socket.IO connections. Deploy it to any Docker
host (Railway, Render, Fly.io…) using the `Dockerfile` here. It runs pending migrations on every
start.

| Variable                                    | Value                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                  | `production` (already set in the image)                                                    |
| `CLIENT_ORIGIN`                             | the web app's URL, e.g. `https://<your-app>.vercel.app` (comma-separate several; required) |
| `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | from your providers (Neon/Supabase URLs need `?sslmode=require`)                           |
| `JWT_ACCESS_SECRET`, `COOKIE_SECRET`        | new random values, not the local ones                                                      |
| `DB_ENCRYPTION_KEY`                         | new 32-byte base64 key, kept safe                                                          |
| `TRUST_PROXY`                               | number of proxies in front of the API, usually `1` (the host's load balancer)               |
| `SMTP_*`, `MAIL_FROM`, `SENTRY_*`, `TURN_*` | as needed                                                                                  |

Most hosts inject `PORT`. Health check: `GET /health`. Seed once from the host's shell if you want
the admin user: `npm run db:seed`. `HOST_IP`, `API_PORT`, `WEB_PORT` and `HTTPS` are local-only.

## Known gaps

- Multi-tenancy is row-level; roles are global per user; presence broadcasts use one shared room.
- Meetings: no recording or recurring meetings; calls over 12 people need an SFU.
- `typescript-eslint` doesn't support TypeScript 7 yet, so ESLint only covers JS files.
  `npm run typecheck` is the correctness check.
- No automated tests yet.
