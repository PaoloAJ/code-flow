# Codebase Visualizer

An Excalidraw-style architecture whiteboard that generates its starting diagram from real code. Point it at a repository (GitHub URL or local path) and get one node per semantic component — services, frontends, libraries, lambdas, databases, external APIs — with routes, outbound calls, metrics, and bottleneck signals. Then draw on top of it and share a live link for realtime collaboration.

## Run locally

```bash
npm install
npm run dev --workspace @codeviz/server   # API on http://127.0.0.1:4400
npm run dev --workspace @codeviz/web      # app on http://127.0.0.1:5573
```

No configuration needed: local mode uses an anonymous account and allows analyzing local paths.

## Deploy

One container serves the API, the WebSocket collab hub, and the built web app. Users land on a sign-in page, and every account gets a dashboard of its saved diagrams.

### 1. Get Clerk keys (recommended)

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) (enable Email or any social provider).
2. Copy the **Publishable key** (`pk_…`) and **Secret key** (`sk_…`) from *Configure → API keys*.
3. Provide them as `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` wherever you deploy. Skipping this step is fine — the app falls back to its built-in email+password accounts.

### 2. Pick a host

**Any Docker host / VPS**

```bash
CLERK_SECRET_KEY=sk_live_…      \
CLERK_PUBLISHABLE_KEY=pk_live_… \
docker compose up --build -d    # app on http://localhost:4400
```

Put a TLS proxy (Caddy, nginx, Traefik) in front and set `SECURE_COOKIES=true`. Diagrams/accounts persist in the `codeviz-data` volume.

**Render** — push the repo to GitHub, then *New + → Blueprint* and point it at the repo; [render.yaml](render.yaml) provisions the service, the `/data` disk, and the health check. Set the two Clerk keys in the dashboard when prompted.

**Fly.io**

```bash
fly launch --copy-config --no-deploy   # uses fly.toml; pick an app name + region
fly volumes create codeviz_data --size 1
fly secrets set CLERK_SECRET_KEY=sk_live_… CLERK_PUBLISHABLE_KEY=pk_live_…
fly deploy
```

| Env var | Default (compose) | Meaning |
| --- | --- | --- |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | — | Enables [Clerk](https://clerk.com) sign-in (create an app at dashboard.clerk.com → API keys). Without keys the app uses its built-in email+password accounts. |
| `AUTH_REQUIRED` | `true` | Require sign-in for all diagram/analysis APIs. |
| `ALLOW_LOCAL_PATHS` | `false` | Allow analyzing server-filesystem paths (keep off when hosted). |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS. |
| `ANTHROPIC_API_KEY` | — | Enables Claude-powered component summaries and bottleneck analysis. |
| `DATA_DIR` | `/data` (volume) | SQLite database + repo clone cache. |

The frontend needs no rebuild for Clerk: the publishable key is served at runtime via `/api/config`, and Clerk's code is only downloaded when configured.

## Development

```bash
npm test --workspace @codeviz/analyzer      # analyzer unit tests
npm run build --workspace @codeviz/web      # typecheck + production build
npm run build --workspace @codeviz/server   # typecheck
```

Architecture, conventions, and verified-state notes live in [.claude/](.claude/).
