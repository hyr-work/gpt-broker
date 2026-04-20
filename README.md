# GPT Broker 

Keep your OpenAI token out of the frontend and gate access behind Supabase-authenticated users. Exposes a `/metrics` endpoint for Prometheus.

## Environment

Create a single `.env` file in the project root with:

```
OPENAI_API_KEY=your-openai-api-key
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_KEY=your-supabase-service-key
REDIS_URL=redis://redis-stack:6379
```

Notes:

- Rate limit: 100 requests per user per 1-hour window.
- `REDIS_URL` defaults to a local Redis container named `redis-stack`.
- The server reads env vars directly (`process.env`) and also loads `.env` if present (`dotenv/config`).

## Local Development

- Prerequisites: Docker installed.
- Start services:
  - `docker compose up -d`
  - This launches `redis-stack` and `gpt-broker` using `.env`.
- Stop services: `docker compose down`
- Broker listens on `http://localhost:8011`.

## Endpoints

- `POST /stream` — Streams chat completions back to client.
- `POST /gpt-4o` — Simple 4o endpoint, supports `temperature`.
- `POST /v2/advanced-gpt-4o-mini-complete` — Advanced with temperature.
- `POST /advanced-gpt-4o-mini-complete` — Advanced prompt control.
- `GET /simple-gpt-4o-mini-complete?prompt=...` — Simple query param.
- `GET /metrics` — Prometheus metrics. Restrict access.

All POST endpoints require header: `Authorization: Bearer <supabase-access-token>`.

## Production (GitHub Actions → VM)

This repo includes CI/CD workflows that build and deploy to a self-hosted runner VM.

1. Configure repository secrets in GitHub (Settings → Secrets and variables → Actions):

- `DOCKER_USERNAME`, `DOCKER_PASSWORD`
- `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Optional: `REDIS_URL` (omit to use local Redis container)

2. VM prerequisites (self-hosted runner):

- Docker installed and available via `sudo`.
- Self-hosted runner registered and online.

3. Deployment behavior:

- CI builds and pushes `skillsyncrecruiter/gpt-broker:latest`.
- CD on the VM:
  - Prunes disk, logs into Docker Hub, pulls latest image.
  - Ensures a Docker network `gpt-broker-net` exists.
  - Ensures a `redis-stack` container is running on that network.
  - Runs `gpt-broker` on port `8011`, injecting env from GitHub Secrets using `-e` flags.
  - If `REDIS_URL` secret is not set, it defaults to `redis://redis-stack:6379`.

4. Access:

- Broker: `http://<vm-host>:8011`
- Redis Stack UI (if needed): `http://<vm-host>:8001` (exposed by CD Redis step)

## Testing

See `test-gpt-broker` for the end-to-end test suite targeting local and production endpoints.
