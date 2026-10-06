export type {
  BestArtistAward,
  CrowdFavoriteAward,
  FastestGuesserAward,
  FinalAwards,
  StreakMasterAward,
} from "./models/awards";
export { createGameStats } from "./models/game-stats";
export type { FinalGameResults, GameStats } from "./models/game-stats";
export type { PlayerScore } from "./models/player-score";
export type {
  CorrectGuess,
  DrawingStats,
  IncorrectGuess,
  PlayerReaction,
  RoundStats,
  StartRoundInput,
} from "./models/round-stats";
export { calculateFinalAwards, calculateFinalResults } from "./scoring/award-calculator";
export { getRevealedPositions, getWordChoices, normalizeGuess } from "./game/word-bank";
export {
  addPlayerPoints,
  calculateGuessScore,
  getPlayerScore,
  rankPlayerScores,
  setPlayerScore,
} from "./scoring/score-calculator";
export type { GuessScoreBreakdown } from "./scoring/score-calculator";
export {
  endRound,
  getCorrectGuesserIds,
  getRoundStats,
  recordGuess,
  recordHint,
  recordReaction,
  registerPlayer,
  setDrawingStrokeCount,
  startRound,
} from "./scoring/statistics";
