# Realtime server

The realtime server is the authority for every room and game. Keep Socket.IO parsing, connection/session checks, room membership, authorization, timers, and broadcasts in `src/game-server.ts`. Keep reusable scoring and statistics rules in `packages/game-engine`; keep payload and snapshot types in `packages/shared`. The browser sends requests and renders server snapshots/results. It never supplies an authoritative identity, role, score, clock, phase, answer, or award.

## Run locally

From the repository root, configure `apps/web/.env.local` from `apps/web/.env.example`, then run:

```sh
npm run dev
```

The default web origin and server port are `http://localhost:3000` and `3001`. Configure the server with `PORT`, `WEB_ORIGIN`, and optionally `TRUST_PROXY`; `WEB_ORIGIN` is a comma-separated allowlist. The web client reads `NEXT_PUBLIC_SOCKET_URL` at build time. `npm run dev:server` and `npm run dev:web` start one process at a time. Do not put production URLs or secrets in source files.

## Production execution

In production, compile the TypeScript packages and server, then run the compiled JavaScript directly with Node (no `tsx` or development runtime):

```sh
npm run build
npm run start --workspace=@doodlerush/server
# or from root:
npm run start:server
```

The server process starts `node dist/index.js`, binding to the configured `PORT` (default 3001).

## Health check endpoints

The server exposes lightweight, unauthenticated health check endpoints on its HTTP listener:

- `GET /health` or `GET /healthz`
  - Returns HTTP `200 OK`
  - Headers: `Content-Type: application/json`, `Cache-Control: no-store`
  - Body: `{"status":"ok"}`
- `HEAD /health` or `HEAD /healthz`
  - Returns HTTP `200 OK` with an empty body
- Non-GET/HEAD methods on `/health` return `405 Method Not Allowed`.
- Unrecognized non-Socket.IO paths return `404 Not Found`.

The health check does NOT expose room counts, player IDs, session tokens, environment variables, or stack traces, making it safe for container orchestrators, cloud load balancers, and uptime monitors.

## Trust, guest sessions, and room boundaries

- On room creation or join, the server issues a cryptographically secure, unpredictable 256-bit opaque session token (`crypto.randomBytes(32).toString('hex')`) via `GuestSessionStore`. The token is associated in server memory with `(playerId, roomCode)`. A client cannot forge or choose arbitrary player IDs.
- In-flight guest sessions are stored behind the `GuestSessionStore` abstraction with bounded memory (default 2,048 entries), automatic TTL expiration (default 30 minutes), and LRU eviction when capacity is reached.
- When a socket connection drops involuntarily, the player enters a bounded disconnect grace period (default 30 seconds). During grace, the player is marked `connected: false`, but their seat, score, and roles are preserved. Reconnecting within grace with a valid session restores the player identity and state. If grace expires, the player is permanently removed (in lobby) or marked disconnected (in game), host role is transferred deterministically to the next connected player in join order, and drawer rounds are completed/advanced without stalling.
- If a client reconnects while an old socket is still alive, the server applies a deterministic takeover policy: the old socket immediately loses room authorization, receives a `SESSION_REPLACED` error, and is disconnected, ensuring two sockets can never control the same player.
- Involuntary disconnects and recoveries preserve role privacy: a reconnecting drawer receives the active `secretWord`, while a reconnecting guesser receives only public state with masked words. Word options and active secret words are never leaked to guessers.
- Voluntary `room:leave` immediately destroys the session and seat, bypassing the grace timer.
- `rooms` is a server-instance-local `Map<RoomCode, Room>`. Each command resolves the caller's room before reading or mutating it. Room codes are eight characters from a 32-character alphabet (40 bits of randomness).

## Reverse proxy and trusted IP handling

- Behind a reverse proxy (e.g. Cloudflare, Nginx, Caddy, AWS ALB), `socket.handshake.address` identifies the proxy rather than the end client.
- Set `TRUST_PROXY=true` in the environment to instruct the server to read client IP from the leftmost address in `X-Forwarded-For`, validated as a legitimate IPv4/IPv6 address via Node's `net.isIP`.
- When `TRUST_PROXY` is false (the default), `X-Forwarded-For` is strictly ignored and untrusted, preventing IP header spoofing in direct-connect or development environments.

## Event contract and game state

`packages/shared/src/index.ts` is the typed transport contract (`ClientToServerEvents`, `ServerToClientEvents`, `RoomSnapshot`, `PublicGameState`, and drawing/chat payloads). Client events are action requests. The server validates and applies them, then emits snapshots or result events. Update the contract and both ends together when changing a payload; keep event payloads typed and avoid `any`.

The server owns the state machine: lobby → word selection → drawing → round results → next round or game results. The host starts/advances/rematches/returns the room; the current drawer selects one of their server-generated options. Word-selection and round deadlines, hint reveals, and round completion are scheduled server-side. `startsAt` and `endsAt` let clients display a synchronized countdown; handlers also check the deadline and finish an expired round before accepting a late action.

Secret data stays in the internal room game state and the engine's private `GameStats`. Public `RoomSnapshot.game` contains only the masked word and revealed positions. Word options and `secretWord` in `round:started` go only to the active drawer's socket. `round:ended` intentionally reveals the answer to everyone after the round is over. Do not add the answer or options to lobby/game snapshots or guesser events.

## Validation and limits

Each handler resolves membership and permissions before applying a privileged action. Runtime checks are required even though TypeScript types the event contract: incoming socket payloads are untrusted. Exact object-key checks reject unexpected fields; profile, room settings, guesses, reactions, and drawing commands have explicit allowlists/bounds. The server owns names and IDs attached to chat/reaction events. React renders chat as text; do not switch to raw HTML rendering.

Drawing updates are accepted only from the active drawer during drawing. Commands are bounded to 40 strokes, 400 points per stroke, and 4,000 total points, with normalized finite coordinates, known colors/tools, and brush sizes from 1–30. Socket.IO's HTTP buffer is capped at 64 KiB. The server admits at most 256 simultaneous Engine.IO connections and 128 in-memory rooms by default; `GameServerOptions` can lower these limits for tests. Per-connection event limits apply to gameplay, room actions, and reconnect attempts. Room creation is limited to 30 attempts per peer address per minute; room joins and reconnects to 60 attempts per peer address per minute. The address table is capped at 10,000 entries and rejects new keys when full until expired windows can be removed.

Production startup requires `NODE_ENV=production`, an explicit comma-separated `WEB_ORIGIN` containing only HTTPS origins, and a valid `PORT`; the server refuses to start with a missing/wildcard/non-HTTPS production origin. Development defaults to `http://localhost:3000`.

## Server lifecycle and graceful shutdown

- Rooms are cleaned up when empty, inactive for 30 minutes, or when all players' disconnect grace periods expire.
- All scheduled timers (word selection, round duration, hint reveals, disconnect grace, and maintenance sweep) are tracked and cleared on room destruction and server shutdown.
- The server traps `SIGTERM` and `SIGINT` (as well as unhandled process exceptions) to perform a graceful shutdown: stops admitting new requests, closes Socket.IO and the HTTP server, clears all active timers, and exits cleanly.
- State is currently kept in process memory; restarting the process clears in-memory rooms.

## Scoring, statistics, and awards

`InternalGame.stats` is the authoritative `GameStats` instance. The server registers the game roster and records accepted guess/reaction/hint/drawing events through `packages/game-engine/src/scoring/statistics.ts`. Correct guesses are compared against the server-held answer, timed with the server clock, accepted once per player per round, and scored with `score-calculator.ts`. Drawer round bonuses are also applied by the server. At game end, `calculateFinalResults` produces rankings and Phase 1.5 awards from the recorded statistics. The web Results screen only renders the `game:ended` result.

Do not derive final awards in React or accept score/result fields from a browser. See the game-engine README for formulas, eligibility, deterministic tie-breakers, and model boundaries.

## Tests and maintenance

Run `npm test` from the root. Game-engine unit tests cover the deterministic score/statistics/award rules. Server tests start a real local Socket.IO server and multiple socket clients:

- `apps/server/test/address-rate-limiter.test.ts`
- `apps/server/test/config.test.ts`
- `apps/server/test/session-store.test.ts`
- `apps/server/test/health.test.ts`
- `apps/server/test/game-server.test.ts`
- `apps/server/test/session-recovery.test.ts`
- `tests/smoke-multiplayer.ts`

Test-only `getRoomSnapshot`, `getRoomStats`, and `getSessionCount` accessors are returned by `createGameServer`; they are for server tests/diagnostics and must not be exposed as a client API.
