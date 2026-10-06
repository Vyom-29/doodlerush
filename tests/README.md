# Test layout

Tests live beside their owning packages and in the root tests directory:

- `packages/game-engine/test/award-calculator.test.ts` covers score/statistics and deterministic
  award rules (13 tests).
- `apps/server/test/address-rate-limiter.test.ts` covers peer-address sliding window rate limiting (2 tests).
- `apps/server/test/config.test.ts` covers server environment validation and trusted proxy options (4 tests).
- `apps/server/test/session-store.test.ts` covers guest session token generation, bounded storage, and TTL pruning (4 tests).
- `apps/server/test/game-server.test.ts` exercises server-authoritative multiplayer behavior, permissions, and security (11 tests).
- `apps/server/test/session-recovery.test.ts` exercises guest session recovery, disconnect grace periods, role preservation, and duplicate takeover (14 tests).
- `tests/smoke-multiplayer.ts` executes an end-to-end multi-client multiplayer smoke test against the compiled production server, validating all 10 verification steps including real disconnect/reconnect.

Run all unit and integration suites from the repository root with `npm test`.
Run the multiplayer production smoke test with `npx tsx tests/smoke-multiplayer.ts`.
