# Poker777 Backend

Core REST API for the Poker777 multiplayer web poker game.

## Stack
- **Runtime:** Node.js 20+ (ESM)
- **Framework:** Express 4
- **DB:** MySQL 8 (`mysql2/promise`)
- **Cache:** Redis 7 (`ioredis`) — shared with the WebSocket/Game team
- **Auth:** JWT HS256 + bcrypt
- **Validation:** zod

## Quick start

```bash
# 1. Install deps
npm install

# 2. Start infra (from repo root)
docker compose up -d

# 3. Copy env and adjust if needed
cp .env.example .env

# 4. Run migrations (creates tables + seed schema)
npm run migrate

# 5. Start dev server (auto-reload on save)
npm run dev
```

Server listens on http://localhost:4000 — check `GET /health`.

## Project structure

```
backend/
├── src/
│   ├── config/         # env, db, redis singletons
│   ├── middleware/     # auth, error, rateLimit, validate
│   ├── routes/         # express routers per resource
│   ├── controllers/    # request handlers
│   ├── services/       # business logic (auth, user, wallet, table)
│   ├── scripts/        # one-off scripts (migrate.js)
│   ├── test/           # node:test suites
│   └── server.js       # app entrypoint
├── .env.example
└── package.json
```

## Endpoints (Phase 1 scope)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | no | register + welcome bonus |
| `POST` | `/auth/login` | no | login, returns JWT |
| `GET` | `/users/me` | yes | profile + balance + avatar |
| `PATCH` | `/users/me` | yes | update avatar |
| `GET` | `/health` | no | liveness |

Upcoming (later phases): `/tables`, `/wallet/*`.

## WebSocket game rules

- Small and big blinds default to 10/20 chips. Override them with `POKER_SMALL_BLIND` and `POKER_BIG_BLIND` in the backend environment.
- The dealer button rotates by occupied seat; heads-up play posts the small blind from the button.
- Decks use Node's cryptographic random number generator for Fisher-Yates shuffling.
- All-in contributions are tracked per hand and settled into main/side pots. A short all-in raise does not reopen raising for players who already acted.
- Turn deadlines are stored in Redis and recovered when the Node process restarts. Disconnected seats remain reserved for 30 seconds so the same authenticated user can rejoin without buying in again.
- Deadline recovery depends on the room/player state remaining in Redis; configure Redis persistence if deadlines must survive a Redis restart as well.

Use `frontend/test.html` to manually exercise a hand with two or more sessions. `DROP CONNECTION` followed by `REJOIN` tests the grace window; leave a turn idle for 15 seconds to see the automatic check/fold.
