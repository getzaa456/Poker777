# Poker777 Deploy

## Requirements

- Docker Desktop
- Git

## Setup

1. Clone project

```bash
git clone <repo-url> Poker777
cd Poker777
```

2. Create `.env` at project root and configure MySQL, backend, Redis, and JWT values. Every backend task must use the same Redis endpoint and a unique `INSTANCE_ID` (the task ID is a good value).

3. Start everything

```bash
docker compose up -d --build
```

Docker Compose will start:

- MySQL
- Redis
- Backend API
- Frontend

The backend will run database migration automatically before starting.

## Open

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- Health check: http://localhost:4000/health

## WebSocket scaling

The backend uses two dedicated Redis connections for Pub/Sub and publishes table events to the `chat` channel. Every backend instance subscribes to that channel and forwards only events for rooms with clients connected to that instance. Game actions also use a short Redis lock per room so an action or timeout is processed once when several instances receive it.

For AWS:

- Put all backend tasks behind an Application Load Balancer target group that supports WebSocket upgrades on `/ws` and forwards normal HTTP requests to the same service.
- Set `REDIS_HOST` and `REDIS_PORT` to the ElastiCache for Redis endpoint. Do not use `127.0.0.1` inside a task.
- Use a unique `INSTANCE_ID` per task for tracing. Do not use it as a routing key.
- Configure security groups and TLS so the browser uses `wss://` in production, and set `VITE_API_BASE` to the public HTTPS API origin before building the frontend.
- Set `CORS_ALLOWED_ORIGINS` to the exact frontend origin. The frontend derives the WebSocket URL from `VITE_API_BASE`, so no separate browser-side Redis or sticky-session configuration is needed.

Redis is part of the correctness path for multi-instance game state. Keep it highly available and monitor connection errors, rejected locks, and Pub/Sub lag before enabling automatic task scaling.

## Useful commands

Check containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

Reset database and volumes:

```bash
docker compose down -v
docker compose up -d --build
```
