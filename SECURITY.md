# Security Policy

## Reporting Security Issues

We take the security of DoodleRush seriously. If you discover a security vulnerability, please report it responsibly rather than opening a public issue.

- **Email**: security@doodlerush.example.com _(or contact repository maintainers via private channels)_
- **Response Window**: We acknowledge security reports within 48 hours and aim to provide a mitigation or patch timeline within 7 days.
- **Scope**: Please include detailed steps to reproduce the issue, proof-of-concept scripts or payloads, and the affected components.

---

## Security Architecture & Threat Model

DoodleRush is designed with defense-in-depth principles across its frontend and realtime backend layers:

### 1. Server Authority

- **No Client Authority**: The browser client is strictly a rendering and input interface. All game timers, word selection, round transitions, drawing authorization, guess validation, scoring, statistics calculation, and final awards are computed and enforced exclusively on the server.
- **Word Secrecy**: The secret word is transmitted _only_ to the authorized drawer's socket during their turn. Guessers receive only masked character lengths and gradual hint reveals computed by the server. Even if a guesser inspects network frames or socket state, the word is not present.
- **Deterministic Awards**: End-of-game awards (Fastest Guesser, Best Artist, Crowd Favorite, Streak Master) are evaluated by a pure mathematical engine from verified server statistics, eliminating client manipulation of awards.

### 2. Session & Identity Security

- **Temporary Guest Sessions**: Players connect as temporary guests. No passwords, credentials, or persistent user accounts are stored.
- **Cryptographic Tokens**: Session recovery tokens are generated using Node.js `crypto.randomBytes(32)` (256 bits of cryptographic entropy). Tokens are never guessable or sequential.
- **Room-Scoped Sessions**: Session tokens are strictly bound to a single room code. Tokens cannot be used to inspect or join other rooms.
- **Grace Periods & Eviction**: Disconnected players are granted a bounded grace period (default 30 seconds) to recover from brief network interruptions. Unclaimed sessions expire after a strict TTL (30 minutes) and are automatically pruned.

### 3. Transport & Origin Security

- **Strict CORS & Web Origins**: In production (`NODE_ENV=production`), the realtime server strictly enforces that all connections originate from explicitly configured HTTPS origins via `WEB_ORIGIN`. Wildcards (`*`), credentials in origins, and path segments are rejected at server initialization.
- **Transport Encryption**: Production deployments require HTTPS for web traffic and WSS (secure WebSockets) for realtime communication.
- **Strict Headers**: The Next.js frontend enforces:
  - Strict Content Security Policy (CSP) with dynamic per-request cryptographic nonces for script execution.
  - Strict-Transport-Security (HSTS) with a 1-year duration (`max-age=31536000`).
  - `X-Content-Type-Options: nosniff`.
  - `X-Frame-Options: DENY`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

### 4. Abuse Prevention & Resource Limits

- **Bounded Concurrency**: The realtime server process enforces strict limits:
  - Maximum 256 concurrent client connections per process.
  - Maximum 128 active rooms per process.
  - Maximum 2,048 stored guest sessions with LRU-style eviction.
- **Rate Limiting**:
  - Connection-level rate limits prevent spamming room creations, joins, chats, or guesses.
  - Peer address rate limiting (`AddressRateLimiter`) bounds room creation and join attempts across sockets sharing the same IP to prevent room enumeration and denial-of-service.
- **Payload Sanitization**:
  - Strict schema and length validation on all incoming socket payloads.
  - Drawing commands enforce maximum strokes (40), maximum points per stroke (400), and bounded coordinates `[0, 1]`.
  - Chat messages are truncated to 140 characters and sanitized against XSS.

### 5. Reverse Proxy Hardening

When deploying behind a reverse proxy (e.g., Nginx, Caddy, Cloudflare):

- Enable `TRUST_PROXY=true` **only** if the proxy strips untrusted client-supplied `X-Forwarded-For` headers and replaces them with verified client IPs.
- If running directly exposed to the internet, leave `TRUST_PROXY=false` to use the direct TCP peer address and prevent header spoofing.
