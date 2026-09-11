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

2. Create `.env` at project root and configure MySQL, backend, Redis, and JWT values.

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
