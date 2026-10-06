export type AppScreen = "HOME" | "LOBBY" | "GAME" | "ROUND_RESULTS" | "GAME_RESULTS";

export type GamePhase =
  "LOBBY" | "COUNTDOWN" | "WORD_SELECTION" | "DRAWING" | "ROUND_END" | "NEXT_ROUND" | "GAME_END";

export type ChatKind = "system" | "chat" | "guess" | "correct";

export interface GameSettings {
  rounds: number;
  drawSeconds: number;
  wordChoices: number;
  hints: number;
  mode: "Normal" | "Chill";
}

export interface MockPlayer {
  id: string;
  name: string;
  avatar: string;
  isReady: boolean;
  streak: number;
}

export interface ScoredPlayerView extends MockPlayer {
  score: number;
}

export interface ChatEntry {
  id: string;
  kind: ChatKind;
  playerId?: string;
  playerName?: string;
  text: string;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  color: string;
  size: number;
  tool: "pen" | "eraser";
  points: DrawingPoint[];
}

export type PointBreakdown = import("@doodlerush/game-engine").GuessScoreBreakdown;

export interface RoundResult {
  answer: string;
  drawerId: string;
  pointsForCurrentPlayer: PointBreakdown | null;
  drawerBonusForCurrentPlayer: number;
}

export interface MockGameSession {
  phase: GamePhase;
  roundNumber: number;
  totalRounds: number;
  drawerId: string;
  countdown: number;
  secondsLeft: number;
  answer: string | null;
  wordOptions: string[];
  revealedPositions: number[];
  strokes: DrawingStroke[];
  redoStrokes: DrawingStroke[];
  result: RoundResult | null;
  lastUserPoints: PointBreakdown | null;
}

export interface HomeErrors {
  name?: string;
  roomCode?: string;
}

export interface DoodleRushState {
  screen: AppScreen;
  playerId: string;
  displayName: string;
  avatar: string;
  roomCode: string;
  hostId: string;
  players: MockPlayer[];
  settings: GameSettings;
  gameStats: GameStats;
  finalResults: FinalGameResults | null;
  game: MockGameSession | null;
  chat: ChatEntry[];
  messageSequence: number;
  homeErrors: HomeErrors;
  gameFeedback: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  rounds: 3,
  drawSeconds: 60,
  wordChoices: 3,
  hints: 2,
  mode: "Normal",
};

export function createEmptyGame(rounds = DEFAULT_SETTINGS.rounds): MockGameSession {
  return {
    phase: "LOBBY",
    roundNumber: 1,
    totalRounds: rounds,
    drawerId: "",
    countdown: 3,
    secondsLeft: 0,
    answer: null,
    wordOptions: [],
    revealedPositions: [],
    strokes: [],
    redoStrokes: [],
    result: null,
    lastUserPoints: null,
  };
}

export function createInitialState(): DoodleRushState {
  return {
    screen: "HOME",
    playerId: "you",
    displayName: "",
    avatar: "😎",
    roomCode: "",
    hostId: "",
    players: [],
    settings: DEFAULT_SETTINGS,
    gameStats: createGameStats(),
    finalResults: null,
    game: null,
    chat: [],
    messageSequence: 0,
    homeErrors: {},
    gameFeedback: "",
  };
}
import { createGameStats, type FinalGameResults, type GameStats } from "@doodlerush/game-engine";
