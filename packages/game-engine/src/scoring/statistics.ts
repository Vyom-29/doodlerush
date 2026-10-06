import type { GameStats } from "../models/game-stats";
import type { RoundStats, StartRoundInput } from "../models/round-stats";

export function registerPlayer(stats: GameStats, playerId: string): GameStats {
  if (stats.playerScores.some((player) => player.playerId === playerId)) return stats;
  return {
    ...stats,
    playerScores: [...stats.playerScores, { playerId, score: 0 }],
  };
}

export function startRound(stats: GameStats, input: StartRoundInput): GameStats {
  if (stats.rounds.some((round) => round.roundNumber === input.roundNumber)) return stats;

  const round: RoundStats = {
    roundNumber: input.roundNumber,
    drawerId: input.drawerId,
    word: input.word,
    startedAt: input.startedAt,
    endedAt: null,
    correctGuesses: [],
    incorrectGuesses: [],
    hintsUsed: 0,
    reactions: [],
    drawingStats: { strokeCount: 0 },
  };

  return { ...stats, rounds: [...stats.rounds, round] };
}

export function recordGuess(
  stats: GameStats,
  input: {
    roundNumber: number;
    playerId: string;
    timestamp: number;
    elapsedMs: number;
    correct: boolean;
  },
): GameStats {
  if (!stats.playerScores.some((player) => player.playerId === input.playerId)) return stats;
  const roundIndex = stats.rounds.findIndex((round) => round.roundNumber === input.roundNumber);
  if (roundIndex < 0) return stats;

  const round = stats.rounds[roundIndex];
  if (round.endedAt !== null || round.drawerId === input.playerId) return stats;
  if (round.correctGuesses.some((guess) => guess.playerId === input.playerId)) return stats;

  const sequence = nextGuessSequence(round);
  const updatedRound: RoundStats = input.correct
    ? {
        ...round,
        correctGuesses: [
          ...round.correctGuesses,
          {
            playerId: input.playerId,
            timestamp: input.timestamp,
            elapsedMs: Math.max(0, input.elapsedMs),
            sequence,
          },
        ],
      }
    : {
        ...round,
        incorrectGuesses: [
          ...round.incorrectGuesses,
          { playerId: input.playerId, timestamp: input.timestamp, sequence },
        ],
      };

  return replaceRound(stats, roundIndex, updatedRound);
}

export function recordHint(stats: GameStats, roundNumber: number): GameStats {
  return updateActiveRound(stats, roundNumber, (round) => ({
    ...round,
    hintsUsed: round.hintsUsed + 1,
  }));
}

export function recordReaction(
  stats: GameStats,
  input: { roundNumber: number; playerId: string; reaction: string; timestamp: number },
): GameStats {
  if (!stats.playerScores.some((player) => player.playerId === input.playerId)) return stats;
  return updateActiveRound(stats, input.roundNumber, (round) => {
    if (round.drawerId === input.playerId) return round;
    if (round.reactions.some((reaction) => reaction.playerId === input.playerId)) return round;
    return {
      ...round,
      reactions: [
        ...round.reactions,
        { playerId: input.playerId, reaction: input.reaction, timestamp: input.timestamp },
      ],
    };
  });
}

export function setDrawingStrokeCount(
  stats: GameStats,
  roundNumber: number,
  strokeCount: number,
): GameStats {
  return updateActiveRound(stats, roundNumber, (round) => ({
    ...round,
    drawingStats: { strokeCount: Math.max(0, strokeCount) },
  }));
}

export function endRound(stats: GameStats, roundNumber: number, endedAt: number): GameStats {
  return updateActiveRound(stats, roundNumber, (round) => ({
    ...round,
    endedAt: Math.max(round.startedAt, endedAt),
  }));
}

export function getRoundStats(stats: GameStats, roundNumber: number): RoundStats | undefined {
  return stats.rounds.find((round) => round.roundNumber === roundNumber);
}

export function getCorrectGuesserIds(stats: GameStats, roundNumber: number): string[] {
  return getRoundStats(stats, roundNumber)?.correctGuesses.map((guess) => guess.playerId) ?? [];
}

function updateActiveRound(
  stats: GameStats,
  roundNumber: number,
  update: (round: RoundStats) => RoundStats,
): GameStats {
  const roundIndex = stats.rounds.findIndex((round) => round.roundNumber === roundNumber);
  if (roundIndex < 0 || stats.rounds[roundIndex].endedAt !== null) return stats;
  const current = stats.rounds[roundIndex];
  const updated = update(current);
  return updated === current ? stats : replaceRound(stats, roundIndex, updated);
}

function replaceRound(stats: GameStats, index: number, round: RoundStats): GameStats {
  const rounds = [...stats.rounds];
  rounds[index] = round;
  return { ...stats, rounds };
}

function nextGuessSequence(round: RoundStats): number {
  let highest = -1;
  for (const guess of round.correctGuesses) highest = Math.max(highest, guess.sequence);
  for (const guess of round.incorrectGuesses) highest = Math.max(highest, guess.sequence);
  return highest + 1;
}
