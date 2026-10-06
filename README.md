# DoodleRush

> **Draw it. Guess it. Win it.**  
> A fast-paced, real-time multiplayer drawing and guessing party game built with Next.js, Node.js, and Socket.IO.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
  - [Topology](#topology)
  - [Monorepo Structure](#monorepo-structure)
  - [Hosting & Runtime Independence](#hosting--runtime-independence)
- [Environment Configuration](#environment-configuration)
  - [Variable Reference](#variable-reference)
  - [Production Fail-Fast Validation](#production-fail-fast-validation)
- [Getting Started (Development)](#getting-started-development)
- [Production Lifecycle](#production-lifecycle)
  - [Build and Startup Commands](#build-and-startup-commands)
  - [Health Check Endpoints](#health-check-endpoints)
  - [Graceful Shutdown](#graceful-shutdown)
- [Security & Threat Model](#security--threat-model)
  - [Server Authority & Secret Word Isolation](#server-authority--secret-word-isolation)
  - [Guest Session Recovery & Grace Periods](#guest-session-recovery--grace-periods)
  - [HTTP & WebSocket Hardening](#http--websocket-hardening)
  - [Reverse Proxy & IP Rate Limiting](#reverse-proxy--ip-rate-limiting)
  - [Resource Ceilings](#resource-ceilings)
- [Testing & Quality Verification](#testing--quality-verification)
- [Dependency & Vulnerability Audit](#dependency--vulnerability-audit)
- [CI Pipeline](#ci-pipeline)
- [Phase History](#phase-history)

---

## Overview

DoodleRush is a fully server-authoritative multiplayer web application. Players join rooms via cryptographically generated room codes, pick from server-offered words, draw in real time, guess via chat, and compete for deterministic endgame awards calculated directly by a mathematical game engine.

Key architectural properties:

- **Zero Client Authority**: The browser never decides game state, secret words, scores, timers, or awards.
- **Stateless/Ephemeral by Design**: Active games and guest sessions run entirely in server process memory—no databases or persistent user accounts required.
- **Robust Network Recovery**: Players can refresh or briefly disconnect without losing their seat, score, or host/drawer roles thanks to cryptographically secure guest session tokens.

---

## Architecture

### Topology

```
┌──────────────────────────────────────────────┐
│             Web Browser (Client)             │
└──────────────┬───────────────────────────────┘
               │
               │ HTTPS (HTML / Assets / Next.js Bundle)
               ▼
┌──────────────────────────────────────────────┐
│           Next.js 16 Web Application         │
│           (apps/web: React 19, Tailwind)     │
└──────────────┬───────────────────────────────┘
               │
               │ WSS / WebSocket (Typed Socket.IO Protocol)
               ▼
┌──────────────────────────────────────────────┐
│       Node.js Realtime Socket.IO Server      │
│      (apps/server: Room & Session Authority) │
└──────────────┬───────────────────────────────┘
               │
               │ Direct Pure TypeScript Module Invocation
               ▼
┌──────────────────────────────────────────────┐
│          Deterministic Game Engine           │
│  (packages/game-engine: Scoring & Awards)    │
└──────────────────────────────────────────────┘
```

### Monorepo Structure

| Package / App          | Purpose                                                                                     | Runtime                        |
| :--------------------- | :------------------------------------------------------------------------------------------ | :----------------------------- |
| `apps/web`             | Next.js 16 browser application, screens, UI state machine, and canvas rendering.            | Browser / Next.js Node server  |
| `apps/server`          | Node.js + Socket.IO server managing room state, timers, guest sessions, and admission.      | Node.js (long-lived process)   |
| `packages/shared`      | Shared TypeScript types, event definitions, schemas, and payload interfaces.                | Universal (transpiled CJS/ESM) |
| `packages/game-engine` | Pure, deterministic game mechanics: word banks, scoring algorithms, and statistical awards. | Universal (transpiled CJS/ESM) |
| `tests`                | End-to-end integration and smoke verification scripts.                                      | Node.js (`tsx`)                |

### Hosting & Runtime Independence

The web frontend (`apps/web`) and realtime backend (`apps/server`) are decoupled and can be hosted independently:

- **Frontend**: Can run on any Node.js hosting platform, container runtime, or Edge-compatible host (e.g. Vercel, AWS ECS, Cloud Run) that supports Next.js.
- **Realtime Server**: Requires a persistent, long-lived Node.js process (e.g. Railway, Render, Fly.io, AWS EC2/ECS, DigitalOcean) with WebSocket (`WSS`) upgrade support. Serverless lambda functions are **not** suitable for this stateful in-memory Socket.IO architecture.

---

## Environment Configuration

### Variable Reference

| Variable                 | Scope              | Target        | Default (Dev)           | Production Requirement                                                                                           |
| :----------------------- | :----------------- | :------------ | :---------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SOCKET_URL` | **Public Browser** | `apps/web`    | `http://localhost:3001` | **Required.** Must be an explicit HTTPS/WSS URL without credentials or query strings.                            |
| `PORT`                   | **Server Only**    | `apps/server` | `3001`                  | Valid TCP port (1–65535).                                                                                        |
| `WEB_ORIGIN`             | **Server Only**    | `apps/server` | `http://localhost:3000` | **Required in Prod.** Comma-separated HTTPS origins allowed to connect via CORS. Wildcards (`*`) are prohibited. |
| `TRUST_PROXY`            | **Server Only**    | `apps/server` | `false`                 | Set to `true` or `1` only when deployed behind a trusted reverse proxy supplying `X-Forwarded-For`.              |

> [!IMPORTANT]
> `NEXT_PUBLIC_SOCKET_URL` is the **only** environment variable exposed to client browsers. Never prefix server-only variables (`WEB_ORIGIN`, `PORT`, `TRUST_PROXY`) with `NEXT_PUBLIC_`.

### Production Fail-Fast Validation

DoodleRush validates its environment at initialization and fails immediately with actionable errors:

- **`next build`**: The Next.js build script aborts if `NEXT_PUBLIC_SOCKET_URL` is absent, not HTTPS, or contains credentials/query strings.
- **Server Startup**: `apps/server` throws an error on boot if `NODE_ENV=production` and `WEB_ORIGIN` is missing or contains non-HTTPS origins, wildcards, or invalid URLs.

---

## Getting Started (Development)

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer

### Installation

```sh
# Clone the repository and install all monorepo dependencies
npm install
```

### Local Development

1. Copy environment templates:
   ```sh
   cp apps/web/.env.example apps/web/.env.local
   ```
2. Start both frontend and realtime server concurrently:
   ```sh
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser. The Socket.IO server will run on `http://localhost:3001`.

To run components individually:

- `npm run dev:web` — Next.js dev server on port 3000
- `npm run dev:server` — Socket.IO server with TypeScript watch mode on port 3001

---

## Production Lifecycle

### Build and Startup Commands

DoodleRush uses standard monorepo scripts for production execution. Production instances execute pre-compiled JavaScript with Node.js—never development runtimes (`tsx`):

```sh
# 1. Clean installation
npm ci

# 2. Build all workspaces (shared types, engine, web app, server)
npm run build

# 3. Start the realtime server (long-lived Node.js process)
npm run start:server
# (executes 'node dist/index.js' in apps/server)

# 4. Start the Next.js web application
npm run start:web
# (executes 'next start' in apps/web)
```

### Health Check Endpoints

The realtime server provides lightweight HTTP health endpoints for container orchestrators, load balancers, and uptime monitors:

- `GET /health` or `GET /healthz`
  - Responds with `200 OK`
  - Headers: `Content-Type: application/json`, `Cache-Control: no-store`
  - Body: `{"status":"ok"}`
- `HEAD /health` or `HEAD /healthz`
  - Responds with `200 OK` and empty body
- Non-GET/HEAD methods on `/health` return `405 Method Not Allowed`.
- Unknown non-Socket.IO routes return `404 Not Found`.

> [!NOTE]
> The health check strictly exposes `{ "status": "ok" }`. It intentionally exposes zero room data, player information, session counts, or configuration details.

### Graceful Shutdown

The realtime server listens for `SIGTERM` and `SIGINT` signals, as well as unhandled process exceptions:

1. Stops accepting new inbound Socket.IO connections and HTTP requests.
2. Closes active Socket.IO connections cleanly.
3. Clears all active gameplay timers, word selection countdowns, hint reveals, and session sweep intervals.
4. Closes the underlying HTTP server and exits with code 0.

> [!NOTE]
> Because game rooms and guest sessions reside in server process memory, permanently stopping or restarting the server process terminates active rooms.

---

## Security & Threat Model

For our vulnerability disclosure process and security policies, see [SECURITY.md](SECURITY.md).

### Server Authority & Secret Word Isolation

- All clocks, state transitions, word selection, hints, and scoring are computed server-side.
- The secret word is transmitted **exclusively** to the active drawer's socket. Guessers receive only character lengths and server-controlled revealed hint positions.
- Correct guesses are validated server-side; clients never announce correct guesses or score increments.

### Guest Session Recovery & Grace Periods

- Temporary guest sessions use 256-bit cryptographically secure tokens (`crypto.randomBytes(32)`).
- Session tokens are strictly scoped to a single room and stored in a bounded in-memory store (capacity: 2,048).
- Disconnected players receive a 30-second grace period. Reconnecting restores seat, score, and roles.
- If a duplicate connection connects using an active session token, the old connection is immediately revoked and disconnected.
- If a drawer reconnects during an active round, they receive the secret word; guessers never receive the secret word.

### HTTP & WebSocket Hardening

- **CSP Nonces**: Next.js renders script tags protected by per-request dynamic cryptographic nonces (`'strict-dynamic'`).
- **HSTS**: `Strict-Transport-Security: max-age=31536000` enforced on production web responses.
- **Security Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
- **CORS Allowlist**: WebSockets accept connections only from origins listed in `WEB_ORIGIN`.

### Reverse Proxy & IP Rate Limiting

- To prevent IP spoofing, `TRUST_PROXY=true` must be set only behind trusted reverse proxies (e.g. Nginx, Caddy, Cloudflare) that normalize `X-Forwarded-For`.
- The server enforces IP-based rate limiting via `AddressRateLimiter`:
  - 30 room creations per IP per minute.
  - 60 room joins/reconnects per IP per minute.
  - Rate limiter storage is bounded (10,000 IPs max) and fails closed when saturated.

### Resource Ceilings

- Max 256 concurrent Socket.IO connections per server process.
- Max 128 active rooms per server process.
- Max 8 players per room.
- Max 40 drawing strokes per round, 400 points per stroke, 4,000 total points.
- Max 140 characters per chat message.
- 64 KiB maximum Socket.IO HTTP payload buffer.

---

## Testing & Quality Verification

DoodleRush maintains a comprehensive test suite across unit, integration, and end-to-end layers:

```sh
# Run all automated tests (53 tests across engine and server)
npm test

# Run TypeScript compiler checks across all workspaces
npm run typecheck

# Run ESLint across monorepo
npm run lint

# Check Prettier formatting
npm run format:check

# Run multi-client multiplayer smoke test
npx tsx tests/smoke-multiplayer.ts
```

---

## Dependency & Vulnerability Audit

Production dependencies are verified free of vulnerabilities:

```sh
npm audit --omit=dev
# found 0 vulnerabilities
```

### Development-Only Tooling Advisory Note

A non-production advisory exists in development tooling (`GHSA-vfj7-8cjw-p6xm` on `braces@3.0.3` via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`). No patched 3.x release of `braces` exists. Automated npm fixes attempt to downgrade ESLint config to Next 14, which breaks Next 16 linting. Because this vulnerability is confined exclusively to build-time linting tools and is never deployed or bundled into production runtimes, it is documented and monitored rather than forcing a breaking downgrade.

---

## CI Pipeline

Automated continuous integration is configured in `.github/workflows/ci.yml`. On every pull request and push to `main`, the pipeline executes:

1. Dependency installation (`npm ci`)
2. Automated test suite (`npm test`)
3. Static typechecking (`npm run typecheck`)
4. Linting (`npm run lint`)
5. Code format verification (`npm run format:check`)
6. Production build verification (`npm run build`)

---

## Phase History

- **Phase 1**: Frontend screens (Home, Lobby, Game, Results, Drawing Canvas).
- **Phase 1.5**: Centralized game statistics and deterministic award calculation engine.
- **Phase 2**: Server-authoritative multiplayer with Socket.IO, room lifecycle, and private word isolation.
- **Phase 3**: Security hardening (bounded admission, CSP nonces, HSTS, rate limiters, strict CORS).
- **Phase 4**: Guest session recovery, disconnect grace periods, role preservation, duplicate takeover, and graceful shutdown.
- **Phase 5**: Production & GitHub readiness (CI workflow, health checks, environment matrix, SECURITY.md, and documentation).
