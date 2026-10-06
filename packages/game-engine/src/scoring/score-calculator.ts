import type { GameStats } from "../models/game-stats";
import type { PlayerScore } from "../models/player-score";

export interface GuessScoreBreakdown {
  correct: number;
  speed: number;
  streakBonus: number;
  streak: number;
  total: number;
  elapsedSeconds: number;
}

export function calculateGuessScore(
  secondsLeft: number,
  durationSeconds: number,
  currentStreak: number,
): GuessScoreBreakdown {
  const duration = Math.max(1, durationSeconds);
  const remaining = Math.max(0, secondsLeft);
  const elapsedSeconds = Math.max(0, duration - remaining);
  const correct = 300;
  const speed = Math.round((remaining / duration) * 120);
  const streakBonus = currentStreak > 0 ? Math.min(120, currentStreak * 30) : 0;

  return {
    correct,
    speed,
    streakBonus,
    streak: currentStreak + 1,
    total: correct + speed + streakBonus,
    elapsedSeconds,
  };
}

export function setPlayerScore(stats: GameStats, playerId: string, score: number): GameStats {
  if (!stats.playerScores.some((entry) => entry.playerId === playerId)) return stats;
  return {
    ...stats,
    playerScores: stats.playerScores.map((entry) =>
      entry.playerId === playerId ? { ...entry, score: Math.max(0, score) } : entry,
    ),
  };
}

export function addPlayerPoints(stats: GameStats, playerId: string, points: number): GameStats {
  const playerScore = stats.playerScores.find((entry) => entry.playerId === playerId);
  if (!playerScore) return stats;
  return setPlayerScore(stats, playerId, playerScore.score + points);
}

export function getPlayerScore(stats: GameStats, playerId: string): number {
  return stats.playerScores.find((entry) => entry.playerId === playerId)?.score ?? 0;
}

export function rankPlayerScores(scores: readonly PlayerScore[]): PlayerScore[] {
  return [...scores].sort(
    (first, second) => second.score - first.score || compareIds(first.playerId, second.playerId),
  );
}

function compareIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}
