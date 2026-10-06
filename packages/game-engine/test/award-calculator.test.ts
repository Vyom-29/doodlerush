import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFinalResults,
  createGameStats,
  endRound,
  getRoundStats,
  recordGuess,
  recordHint,
  recordReaction,
  registerPlayer,
  startRound,
} from "../src/index.js";
import type { GameStats } from "../src/index.js";

function begin(stats: GameStats, roundNumber: number, drawerId = "drawer"): GameStats {
  return startRound(stats, {
    roundNumber,
    drawerId,
    word: "ROCKET",
    startedAt: (roundNumber - 1) * 120_000,
  });
}

function guess(
  stats: GameStats,
  roundNumber: number,
  playerId: string,
  elapsedMs: number,
  correct = true,
): GameStats {
  const round = getRoundStats(stats, roundNumber);
  assert.ok(round, `round ${roundNumber} has not started`);
  return recordGuess(stats, {
    roundNumber,
    playerId,
    timestamp: round.startedAt + elapsedMs,
    elapsedMs,
    correct,
  });
}

function react(
  stats: GameStats,
  roundNumber: number,
  playerId: string,
  reaction = "🔥",
): GameStats {
  const round = getRoundStats(stats, roundNumber);
  assert.ok(round, `round ${roundNumber} has not started`);
  return recordReaction(stats, {
    roundNumber,
    playerId,
    reaction,
    timestamp: round.startedAt + 1_000,
  });
}

function close(stats: GameStats, roundNumber: number): GameStats {
  const round = getRoundStats(stats, roundNumber);
  assert.ok(round, `round ${roundNumber} has not started`);
  return endRound(stats, roundNumber, round.startedAt + 60_000);
}

test("Fastest Guesser requires three correct guesses and uses average time", () => {
  let stats = createGameStats(["A", "B", "C", "drawer"]);
  const times = [
    { A: 8_000, B: 11_000, C: 5_000 },
    { A: 8_000, B: 11_000, C: 5_000 },
    { A: 8_000, B: 11_000 },
    { B: 11_000 },
  ];

  for (let index = 0; index < times.length; index += 1) {
    const roundNumber = index + 1;
    stats = begin(stats, roundNumber);
    for (const [playerId, elapsedMs] of Object.entries(times[index])) {
      stats = guess(stats, roundNumber, playerId, elapsedMs);
    }
    stats = close(stats, roundNumber);
  }

  assert.deepEqual(calculateFinalResults(stats).awards.fastestGuesser, {
    playerId: "A",
    averageGuessTimeMs: 8_000,
    correctGuessCount: 3,
  });
});

test("Fastest Guesser tie breakers prefer more guesses, then earlier qualification, then ID", () => {
  let stats = createGameStats(["a", "b", "c", "d", "drawer"]);
  const guessCounts = [
    { a: 10_000, b: 10_000, c: 10_000, d: 10_000 },
    { a: 10_000, b: 10_000, c: 10_000, d: 10_000 },
    { a: 10_000, b: 10_000, c: 10_000, d: 10_000 },
    { b: 10_000, c: 10_000 },
  ];
  for (let index = 0; index < guessCounts.length; index += 1) {
    const roundNumber = index + 1;
    stats = begin(stats, roundNumber);
    for (const [playerId, elapsedMs] of Object.entries(guessCounts[index])) {
      stats = guess(stats, roundNumber, playerId, elapsedMs);
    }
    stats = close(stats, roundNumber);
  }
  assert.equal(calculateFinalResults(stats).awards.fastestGuesser?.playerId, "b");

  let earlierStats = createGameStats(["a", "b", "drawer"]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    earlierStats = begin(earlierStats, roundNumber);
    if (roundNumber <= 3) earlierStats = guess(earlierStats, roundNumber, "a", 10_000);
    if (roundNumber >= 2) earlierStats = guess(earlierStats, roundNumber, "b", 10_000);
    earlierStats = close(earlierStats, roundNumber);
  }
  assert.equal(calculateFinalResults(earlierStats).awards.fastestGuesser?.playerId, "a");

  let idStats = createGameStats(["a", "b", "drawer"]);
  for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
    idStats = begin(idStats, roundNumber);
    idStats = guess(idStats, roundNumber, "a", 10_000);
    idStats = guess(idStats, roundNumber, "b", 10_000);
    idStats = close(idStats, roundNumber);
  }
  assert.equal(calculateFinalResults(idStats).awards.fastestGuesser?.playerId, "a");
});

test("Best Artist scores drawing effectiveness and requires two drawing rounds", () => {
  let stats = createGameStats([
    "artist-a",
    "artist-b",
    "guesser-a",
    "guesser-b",
    "reactor-1",
    "reactor-2",
  ]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    const artistId = roundNumber <= 2 ? "artist-a" : "artist-b";
    stats = begin(stats, roundNumber, artistId);
    stats = guess(
      stats,
      roundNumber,
      roundNumber <= 2 ? "guesser-a" : "guesser-b",
      roundNumber <= 2 ? 10_000 : 20_000,
    );
    if (roundNumber > 2) stats = recordHint(stats, roundNumber);
    if (roundNumber <= 2) stats = react(stats, roundNumber, `reactor-${roundNumber}`);
    stats = close(stats, roundNumber);
  }

  const award = calculateFinalResults(stats).awards.bestArtist;
  assert.deepEqual(award, {
    playerId: "artist-a",
    artistScore: 630,
    correctGuesses: 2,
    uniqueReactions: 2,
  });
});

test("Best Artist tie breakers use correct guesses, unique reactions, then player ID", () => {
  let correctTieStats = createGameStats([
    "artist-a",
    "artist-b",
    "guesser-a",
    "guesser-b",
    "guesser-c",
  ]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    const artistId = roundNumber <= 2 ? "artist-a" : "artist-b";
    correctTieStats = begin(correctTieStats, roundNumber, artistId);
    if (roundNumber <= 2) {
      correctTieStats = guess(correctTieStats, roundNumber, "guesser-a", 100_000);
    } else {
      correctTieStats = guess(correctTieStats, roundNumber, "guesser-b", 100_000);
      correctTieStats = guess(correctTieStats, roundNumber, "guesser-c", 100_000);
      correctTieStats = recordHint(correctTieStats, roundNumber);
    }
    correctTieStats = close(correctTieStats, roundNumber);
  }
  assert.equal(calculateFinalResults(correctTieStats).awards.bestArtist?.playerId, "artist-b");

  let reactionTieStats = createGameStats([
    "artist-a",
    "artist-b",
    "guesser-a",
    "guesser-b",
    "reactor-a",
    "reactor-b",
    "reactor-c",
    "reactor-d",
  ]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    const artistId = roundNumber <= 2 ? "artist-a" : "artist-b";
    reactionTieStats = begin(reactionTieStats, roundNumber, artistId);
    reactionTieStats = guess(
      reactionTieStats,
      roundNumber,
      roundNumber <= 2 ? "guesser-a" : "guesser-b",
      roundNumber <= 2 ? 0 : 100_000,
    );
    if (roundNumber <= 2) {
      // Artist A reaches the same round score through speed instead of reactions.
    } else {
      for (const reactor of ["reactor-a", "reactor-b", "reactor-c", "reactor-d"]) {
        reactionTieStats = react(reactionTieStats, roundNumber, reactor);
      }
    }
    reactionTieStats = close(reactionTieStats, roundNumber);
  }
  assert.equal(calculateFinalResults(reactionTieStats).awards.bestArtist?.playerId, "artist-b");

  let idTieStats = createGameStats(["artist-a", "artist-b", "guesser-a", "guesser-b"]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    idTieStats = begin(idTieStats, roundNumber, roundNumber <= 2 ? "artist-b" : "artist-a");
    idTieStats = close(idTieStats, roundNumber);
  }
  assert.equal(calculateFinalResults(idTieStats).awards.bestArtist?.playerId, "artist-a");
});

test("Crowd Favorite counts unique reactors per drawing and breaks ties by drawings", () => {
  let stats = createGameStats(["artist-a", "artist-b", "reactor-a", "reactor-b"]);
  stats = begin(stats, 1, "artist-a");
  stats = react(stats, 1, "reactor-a", "😂");
  stats = react(stats, 1, "reactor-a", "🔥");
  stats = react(stats, 1, "reactor-b", "👏");
  stats = close(stats, 1);

  stats = begin(stats, 2, "artist-b");
  stats = react(stats, 2, "reactor-a");
  stats = close(stats, 2);
  stats = begin(stats, 3, "artist-b");
  stats = react(stats, 3, "reactor-a");
  stats = close(stats, 3);

  assert.equal(getRoundStats(stats, 1)?.reactions.length, 2);
  assert.deepEqual(calculateFinalResults(stats).awards.crowdFavorite, {
    playerId: "artist-b",
    uniqueReactors: 2,
    drawingsReactedTo: 2,
  });
});

test("Crowd Favorite resolves an exact tie by deterministic player ID", () => {
  let stats = createGameStats(["artist-a", "artist-b", "reactor"]);
  stats = begin(stats, 1, "artist-b");
  stats = react(stats, 1, "reactor");
  stats = close(stats, 1);
  stats = begin(stats, 2, "artist-a");
  stats = react(stats, 2, "reactor");
  stats = close(stats, 2);
  assert.equal(calculateFinalResults(stats).awards.crowdFavorite?.playerId, "artist-a");
});

test("final awards recalculate when gameplay reaction statistics change", () => {
  let stats = createGameStats(["artist-a", "artist-b", "reactor"]);
  stats = begin(stats, 1, "artist-a");
  stats = close(stats, 1);
  stats = begin(stats, 2, "artist-b");

  assert.equal(calculateFinalResults(stats).awards.crowdFavorite?.playerId, "artist-a");

  stats = react(stats, 2, "reactor", "👏");
  stats = close(stats, 2);
  assert.equal(calculateFinalResults(stats).awards.crowdFavorite?.playerId, "artist-b");
});

test("Streak Master tracks correct answers across rounds and breaks on incorrect guesses", () => {
  let stats = createGameStats(["player-a", "player-b", "drawer"]);
  for (let roundNumber = 1; roundNumber <= 5; roundNumber += 1) {
    stats = begin(stats, roundNumber);
    if (roundNumber <= 3 || roundNumber === 5) {
      stats = guess(stats, roundNumber, "player-a", 10_000);
    }
    if (roundNumber <= 4) stats = guess(stats, roundNumber, "player-b", 12_000);
    if (roundNumber === 4) stats = guess(stats, roundNumber, "player-a", 15_000, false);
    stats = close(stats, roundNumber);
  }

  assert.deepEqual(calculateFinalResults(stats).awards.streakMaster, {
    playerId: "player-b",
    longestStreak: 4,
    correctGuessCount: 4,
  });
});

test("Streak Master tie breaks by more correct guesses, then player ID", () => {
  let stats = createGameStats(["a", "b", "drawer"]);
  for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
    stats = begin(stats, roundNumber);
    if (roundNumber <= 3) stats = guess(stats, roundNumber, "a", 10_000);
    if (roundNumber <= 4) stats = guess(stats, roundNumber, "b", 10_000);
    stats = close(stats, roundNumber);
  }
  assert.equal(calculateFinalResults(stats).awards.streakMaster?.playerId, "b");

  let idStats = createGameStats(["a", "b", "drawer"]);
  for (let roundNumber = 1; roundNumber <= 3; roundNumber += 1) {
    idStats = begin(idStats, roundNumber);
    idStats = guess(idStats, roundNumber, "a", 10_000);
    idStats = guess(idStats, roundNumber, "b", 10_000);
    idStats = close(idStats, roundNumber);
  }
  assert.equal(calculateFinalResults(idStats).awards.streakMaster?.playerId, "a");
});

test("award eligibility excludes short guess histories, single draws, and no-correct players", () => {
  let stats = createGameStats(["two-guesses", "one-draw", "drawer"]);
  stats = begin(stats, 1, "one-draw");
  stats = guess(stats, 1, "two-guesses", 5_000);
  stats = close(stats, 1);
  stats = begin(stats, 2, "drawer");
  stats = guess(stats, 2, "two-guesses", 5_000);
  stats = close(stats, 2);

  const awards = calculateFinalResults(stats).awards;
  assert.equal(awards.fastestGuesser, null);
  assert.equal(awards.bestArtist, null);
  assert.equal(awards.crowdFavorite?.playerId, "drawer");
  assert.equal(awards.streakMaster?.playerId, "two-guesses");

  let emptyStats = createGameStats(["drawer", "no-guesses"]);
  emptyStats = begin(emptyStats, 1);
  emptyStats = close(emptyStats, 1);
  const emptyAwards = calculateFinalResults(emptyStats).awards;
  assert.equal(emptyAwards.fastestGuesser, null);
  assert.equal(emptyAwards.streakMaster, null);
});

test("late joiners keep their score and do not inherit earlier game statistics", () => {
  let stats = createGameStats(["drawer", "existing"]);
  stats = begin(stats, 1);
  stats = guess(stats, 1, "existing", 8_000);
  stats = close(stats, 1);

  stats = registerPlayer(stats, "late");
  stats = begin(stats, 2);
  stats = guess(stats, 2, "late", 4_000);
  stats = close(stats, 2);

  const results = calculateFinalResults(stats);
  assert.equal(results.rankings.find((score) => score.playerId === "late")?.score, 0);
  assert.equal(results.awards.fastestGuesser, null);
  assert.equal(results.awards.bestArtist?.playerId, "drawer");
  assert.equal(results.awards.crowdFavorite?.playerId, "drawer");
  assert.equal(results.awards.streakMaster?.playerId, "existing");
});

test("duplicate correct guesses and duplicate reactions are recorded only once", () => {
  let stats = createGameStats(["drawer", "guesser", "reactor"]);
  stats = begin(stats, 1);
  stats = guess(stats, 1, "guesser", 9_000);
  stats = guess(stats, 1, "guesser", 4_000);
  stats = react(stats, 1, "reactor", "😂");
  stats = react(stats, 1, "reactor", "🔥");

  const round = getRoundStats(stats, 1);
  assert.equal(round?.correctGuesses.length, 1);
  assert.equal(round?.correctGuesses[0]?.elapsedMs, 9_000);
  assert.equal(round?.reactions.length, 1);
  assert.equal(round?.reactions[0]?.reaction, "😂");
});

test("final score winner and ranking are calculated with deterministic ID ties", () => {
  let stats = createGameStats(["b", "a", "c"]);
  stats = {
    ...stats,
    playerScores: stats.playerScores.map((player) =>
      player.playerId === "c" ? { ...player, score: 25 } : { ...player, score: 100 },
    ),
  };
  const results = calculateFinalResults(stats);
  assert.equal(results.winner?.playerId, "a");
  assert.deepEqual(
    results.rankings.map((player) => player.playerId),
    ["a", "b", "c"],
  );
});
