# NexusDevAI

NexusDevAI is a local-first developer engineering platform for importing GitHub repositories, preparing code for semantic retrieval, answering repository questions, and reviewing pull requests with Ollama.

## What it does

- Connects a GitHub App and imports accessible repositories.
- Synchronizes branches, commits, and source files.
- Chunks and embeds code with local Ollama models.
- Supports semantic code search and source-cited repository Q&A.
- Runs repository-wide AI code reviews from the dashboard.
- Reviews pull request changes automatically in a BullMQ worker.
- Publishes a GitHub pull request review and a `NexusDevAI Review` Check Run.
- Runs lint, tests, Prisma generation, and production builds in GitHub Actions.

## Stack

| Layer        | Technology                 |
| ------------ | -------------------------- |
| Web          | Next.js 16, React 19       |
| API          | NestJS 11, Prisma 6        |
| Data         | PostgreSQL 16, Prisma      |
| Jobs         | Redis 7, BullMQ            |
| Local AI     | Ollama                     |
| Integrations | GitHub App, DuckDNS, Caddy |
| Monorepo     | npm workspaces, Turborepo  |

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Docker Desktop
- [Ollama](https://ollama.com/)
- A GitHub App
- A free [DuckDNS](https://www.duckdns.org/) subdomain
- [Caddy](https://caddyserver.com/) for HTTPS and reverse proxying

## Local setup

From the repository root:

```bash
npm run setup:local
```

The setup command:

- installs the locked npm dependencies;
- creates missing local environment files without overwriting existing ones;
- starts PostgreSQL and Redis;
- generates Prisma Client and applies migrations; and
- installs the required Ollama embedding and generation models.

If a prerequisite is missing, the command stops with a specific message. After it completes, replace the placeholder secrets and GitHub App values in `apps/api/.env`, then start the application:

```bash
npm run dev
```

For manual setup or troubleshooting, run the equivalent commands:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
npm run docker:up
ollama pull embeddinggemma
ollama pull qwen2.5-coder:7b
npx prisma generate --schema apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Local URLs:

- Dashboard: `http://localhost:3000`
- API: `http://localhost:3001/api`
- Swagger: `http://localhost:3001/api/docs`
- Health: `http://localhost:3001/api/health`

## Collaborator setup

Each collaborator should clone the repository and run the local setup independently:

```bash
git clone https://github.com/Rajnisaini895/NexusDevAI.git
cd NexusDevAI
npm run setup:local
```

Each machine gets its own PostgreSQL data, Redis data, Ollama models, and private environment files. Never exchange `.env` files or private keys through Git.

To use repository import and automatic pull request reviews, a collaborator must either create a separate development GitHub App or receive access to a deliberately shared development App through a secure channel. A separate App is recommended because a GitHub App has one configured webhook URL, while each collaborator runs a different local tunnel.

After configuring `apps/api/.env`, run:

```bash
npm run dev
```

## GitHub App setup

Configure the GitHub App with these repository permissions:

| Permission    | Access         |
| ------------- | -------------- |
| Checks        | Read and write |
| Contents      | Read-only      |
| Metadata      | Read-only      |
| Pull requests | Read and write |

Subscribe to the **Pull request** event.

For local installation callbacks, use:

```text
http://localhost:3000/api/provider-connections/github/callback
```

Generate independent secrets for state signing and webhook validation:

```bash
openssl rand -hex 32
```

Set the same webhook secret in both the GitHub App and `GITHUB_WEBHOOK_SECRET`. Never reuse a client secret, JWT secret, or private key as the webhook secret.

Download a GitHub App private key and set `GITHUB_APP_PRIVATE_KEY_PATH` to its absolute local path. Do not commit the key.

## Stable local webhook with DuckDNS and Caddy

Create a DuckDNS subdomain, then copy the local configuration template:

```bash
cp .env.duckdns.example .env.duckdns
```

Set `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN`, and `NEXUSDEV_DOMAIN` in `.env.duckdns`. The token is ignored by Git and must never be committed.

Update DuckDNS to the current public IP:

```bash
set -a
source .env.duckdns
set +a
./scripts/update-duckdns.sh
```

Forward public TCP ports **80** and **443** on the router to this Mac, allow those ports through the macOS firewall, then start Caddy:

```bash
sudo -E caddy run --config ops/caddy/Caddyfile
```

Caddy obtains and renews the HTTPS certificate automatically. The public configuration only proxies `/api/github/webhooks` and `/api/health`; every other path returns `404`.

Configure the GitHub App webhook URL as:

```text
https://YOUR-SUBDOMAIN.duckdns.org/api/github/webhooks
```

DuckDNS and Caddy do not bypass NAT. This setup will not work if the ISP uses carrier-grade NAT or blocks inbound ports 80/443. The Mac, API, Redis, PostgreSQL, Ollama, and Caddy must be running when GitHub delivers a pull request event.

## Repository processing flow

```text
GitHub import
  -> repository sync
  -> source ingestion
  -> code chunking
  -> Ollama embeddings
  -> semantic search / Q&A / code review
```

Automatic pull request reviews follow this path:

```text
GitHub webhook
  -> signature verification
  -> BullMQ job
  -> changed-source review with Ollama
  -> GitHub pull request review
  -> GitHub Check Run
```

## Verification

Run the same gates used by CI:

```bash
npm exec --workspace=api -- eslint "{src,apps,libs,test}/**/*.ts"
npm run lint --workspace=web
npm test --workspace=api -- --runInBand
npm run build
```

The workflow is defined in `.github/workflows/ci.yml` and runs for pull requests, pushes to `main`, and manual dispatches.

## Security

- `.env` files, DuckDNS tokens, GitHub private keys, webhook secrets, and JWT secrets must remain local.
- Rotate any secret that is exposed in chat, logs, screenshots, or commits.
- Keep webhook signature validation enabled.
- Use the minimum GitHub App permissions listed above.
