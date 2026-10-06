export const GameState = {
  Lobby: "LOBBY",
  WordSelection: "WORD_SELECTION",
  Drawing: "DRAWING",
  RoundResults: "ROUND_RESULTS",
  GameResults: "GAME_RESULTS",
} as const;
export type GameState = (typeof GameState)[keyof typeof GameState];

export type PlayerId = string;
export type RoomCode = string;
export type GamePhase = GameState;

export interface PlayerSummary {
  id: PlayerId;
  displayName: string;
  avatarId: string;
  isHost: boolean;
  score: number;
  streak: number;
  connected: boolean;
}

export interface RoomSettings {
  rounds: number;
  roundDurationSeconds: number;
  maxPlayers: number;
  wordChoices: number;
  hints: number;
  mode: "Normal" | "Chill";
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export type DrawingTool = "pen" | "eraser";

export interface DrawingStroke {
  id: string;
  color: string;
  size: number;
  tool: DrawingTool;
  points: DrawingPoint[];
}

export interface ChatMessage {
  id: string;
  playerId: PlayerId | null;
  displayName: string;
  kind: "system" | "chat" | "guess" | "correct";
  text: string;
  sentAt: number;
}

/** Public game state deliberately excludes both the selected word and word options. */
export interface PublicGameState {
  phase: GamePhase;
  roundNumber: number;
  totalRounds: number;
  drawerId: PlayerId | null;
  startsAt: number | null;
  endsAt: number | null;
  durationSeconds: number;
  wordLength: number;
  maskedWord: string[];
  revealedPositions: number[];
  strokes: DrawingStroke[];
  redoCount: number;
  correctPlayerIds: PlayerId[];
}

export interface RoomSnapshot {
  code: RoomCode;
  serverNow: number;
  hostId: PlayerId;
  players: PlayerSummary[];
  settings: RoomSettings;
  state: GameState;
  game: PublicGameState | null;
  chat: ChatMessage[];
}

export interface RoundEndedPayload {
  roundNumber: number;
  totalRounds: number;
  answer: string;
  drawerId: PlayerId;
  correctPlayerIds: PlayerId[];
  scores: Record<PlayerId, number>;
  strokes: DrawingStroke[];
  drawerBonus: number;
}

export interface DrawingOperation {
  type: "add";
  stroke: DrawingStroke;
}

export type DrawingCommand =
  DrawingOperation | { type: "undo" } | { type: "redo" } | { type: "clear" };

export interface ClientToServerEvents {
  "room:create": (payload: { displayName: string; avatarId: string }) => void;
  "room:join": (payload: { roomCode: RoomCode; displayName: string; avatarId: string }) => void;
  "session:reconnect": (payload: { roomCode: RoomCode; sessionToken: string }) => void;
  "room:leave": () => void;
  "game:start": () => void;
  "game:next": () => void;
  "game:rematch": () => void;
  "game:return-lobby": () => void;
  "word:select": (payload: { optionIndex: number }) => void;
  "guess:submit": (payload: { guess: string }) => void;
  "drawing:update": (payload: DrawingCommand) => void;
  "chat:send": (payload: { text: string }) => void;
  "reaction:send": (payload: { reaction: string }) => void;
  "settings:change": (payload: { settings: Partial<RoomSettings> }) => void;
  "player:kick": (payload: { playerId: PlayerId }) => void;
}

export interface ServerToClientEvents {
  "room:created": (payload: {
    roomCode: RoomCode;
    playerId: PlayerId;
    sessionToken: string;
  }) => void;
  "room:joined": (payload: {
    roomCode: RoomCode;
    playerId: PlayerId;
    sessionToken: string;
  }) => void;
  "session:restored": (payload: {
    roomCode: RoomCode;
    playerId: PlayerId;
    sessionToken: string;
  }) => void;
  "room:state": (room: RoomSnapshot) => void;
  "player:joined": (payload: { player: PlayerSummary }) => void;
  "player:left": (payload: { playerId: PlayerId }) => void;
  "settings:updated": (payload: { settings: RoomSettings }) => void;
  "game:started": (payload: { totalRounds: number }) => void;
  /** Sent only to the active drawer. */
  "word:selection": (payload: { options: string[]; deadline: number }) => void;
  /** Secret word is sent only to the active drawer. */
  "round:started": (payload: {
    roundNumber: number;
    totalRounds: number;
    drawerId: PlayerId;
    startsAt: number;
    endsAt: number;
    durationSeconds: number;
    wordLength: number;
    secretWord?: string;
  }) => void;
  "drawing:updated": (payload: {
    playerId: PlayerId;
    operation: DrawingCommand;
    strokes: DrawingStroke[];
    redoCount: number;
  }) => void;
  "guess:result": (payload: {
    playerId: PlayerId;
    correct: boolean;
    pointsAwarded: number;
    score: number;
    streak: number;
    elapsedMs?: number;
    scoreBreakdown?: import("@doodlerush/game-engine").GuessScoreBreakdown;
  }) => void;
  "chat:message": (message: ChatMessage) => void;
  "reaction:received": (payload: {
    playerId: PlayerId;
    displayName: string;
    reaction: string;
    sentAt: number;
  }) => void;
  "round:ended": (payload: RoundEndedPayload) => void;
  "game:ended": (payload: import("@doodlerush/game-engine").FinalGameResults) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

/** Identity is generated for each server connection and is never accepted from event payloads. */
export interface SocketData {
  playerId: PlayerId;
  roomCode?: RoomCode;
  sessionToken?: string;
  limits?: Record<string, { startedAt: number; count: number }>;
}
