export interface CorrectGuess {
  playerId: string;
  timestamp: number;
  elapsedMs: number;
  sequence: number;
}

export interface IncorrectGuess {
  playerId: string;
  timestamp: number;
  sequence: number;
}

export interface PlayerReaction {
  playerId: string;
  reaction: string;
  timestamp: number;
}

export interface DrawingStats {
  strokeCount: number;
}

export interface RoundStats {
  roundNumber: number;
  drawerId: string;
  word: string;
  startedAt: number;
  endedAt: number | null;
  correctGuesses: CorrectGuess[];
  incorrectGuesses: IncorrectGuess[];
  hintsUsed: number;
  reactions: PlayerReaction[];
  drawingStats: DrawingStats;
}

export interface StartRoundInput {
  roundNumber: number;
  drawerId: string;
  word: string;
  startedAt: number;
}
