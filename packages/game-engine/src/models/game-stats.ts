import type { FinalAwards } from "./awards";
import type { PlayerScore } from "./player-score";
import type { RoundStats } from "./round-stats";

export interface GameStats {
  playerScores: PlayerScore[];
  rounds: RoundStats[];
}

export interface FinalGameResults {
  rankings: PlayerScore[];
  winner: PlayerScore | null;
  awards: FinalAwards;
}

export function createGameStats(playerIds: readonly string[] = []): GameStats {
  return {
    playerScores: [...new Set(playerIds)].map((playerId) => ({ playerId, score: 0 })),
    rounds: [],
  };
}
