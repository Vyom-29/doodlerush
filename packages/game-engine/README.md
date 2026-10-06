# Game engine

This package contains transport-independent gameplay scoring and statistics. It does not own
Socket.IO connections, room membership, authorization, timers, or React state. In Phase 2,
`apps/server` validates each request and feeds accepted server-timed events into this package.

## Module boundaries

- `src/models/player-score.ts`, `round-stats.ts`, `game-stats.ts`, and `awards.ts` define separate
  score, round history, aggregate statistics, and final-award shapes.
- `src/scoring/score-calculator.ts` calculates guess score breakdowns and rankings. These gameplay
  points are separate from award formulas.
- `src/scoring/statistics.ts` records rounds, first correct guesses, incorrect guesses, hints,
  reactions, and drawing stroke counts. It is pure event-fed state transformation; timestamps are
  passed in by the caller so the server can be authoritative.
- `src/scoring/award-calculator.ts` deterministically calculates final awards and results from
  `GameStats`. It does not read UI state, the current time, or random values.
- `src/game/word-bank.ts` provides word normalization, choices, and hint positions for the game
  service to use.

`src/index.ts` is the public package surface. Add shared gameplay rules here rather than duplicating
them in React or the transport server. Server-only secrets may be present in internal `RoundStats`
records; do not serialize those records to guessers. The public room snapshot and private drawer
events are defined separately in `packages/shared`.

## Statistics and awards

`GameStats` contains `playerScores` and `rounds`; it is not a room/session object. A round records
drawer and word internally, timestamps, ordered guess events, hints, reactions, and drawing counts.
`recordGuess` ignores unknown players, drawer guesses, ended rounds, and any guess after that
player's first correct guess for the round. Guess event sequence numbers make same-time streak
ordering deterministic. `recordReaction` stores at most one reaction per player per round.

`calculateFinalResults` ranks the existing gameplay scores and returns awards separately. Current
award rules are:

- **Fastest Guesser:** at least 3 correct guesses; lowest average elapsed time wins. Ties go to
  more correct guesses, earlier third correct guess, then lexicographically lower player ID.
- **Best Artist:** at least 2 drawings; per drawing, `100 × correct guesses + sum(max(0, 100 −
elapsed seconds)) + 100 when no hint was used + 25 × unique reactors`. Highest total wins. Ties
  go to more correct guesses, more unique reactions, then lower player ID.
- **Crowd Favorite:** at least 1 drawing; score is the sum of unique reactors per drawing. Ties go
  to more total unique reactors, more drawings that received a reaction, then lower player ID.
- **Streak Master:** longest consecutive correct-guess event sequence, with incorrect guesses
  breaking a streak. Events are ordered by timestamp, round number, then event sequence. Ties go to
  more total correct guesses, then lower player ID.

The gameplay score is separate: a correct guess earns 300 base points, up to 120 rounded speed
points, and up to 120 streak bonus points; the server adds a 100-point drawer bonus at round end.
Current award eligibility and tie-break rules live in `src/scoring/award-calculator.ts` alongside
their implementation; cover rule changes with `test/award-calculator.test.ts`. Keep formulas there,
not in the Results UI. The server sends calculated results to clients only after game completion.

Run this package's tests with `npm run test --workspace=@doodlerush/game-engine`; run the full
monorepo verification from the root with `npm test`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, and `npm run build`.
