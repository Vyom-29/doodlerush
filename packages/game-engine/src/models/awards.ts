export interface BestArtistAward {
  playerId: string;
  artistScore: number;
  correctGuesses: number;
  uniqueReactions: number;
}

export interface FastestGuesserAward {
  playerId: string;
  averageGuessTimeMs: number;
  correctGuessCount: number;
}

export interface CrowdFavoriteAward {
  playerId: string;
  uniqueReactors: number;
  drawingsReactedTo: number;
}

export interface StreakMasterAward {
  playerId: string;
  longestStreak: number;
  correctGuessCount: number;
}

export interface FinalAwards {
  bestArtist: BestArtistAward | null;
  fastestGuesser: FastestGuesserAward | null;
  crowdFavorite: CrowdFavoriteAward | null;
  streakMaster: StreakMasterAward | null;
}
