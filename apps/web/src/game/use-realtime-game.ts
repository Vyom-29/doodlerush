"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import type {
  ChatEntry,
  DrawingStroke,
  GamePhase as UiGamePhase,
  GameSettings,
  MockGameSession,
  MockPlayer,
  ScoredPlayerView,
} from "@/game/mock-game-state";
import type { ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from "@doodlerush/shared";
import type { FinalGameResults, GuessScoreBreakdown } from "@doodlerush/game-engine";

type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RealtimeGameView {
  connected: boolean;
  statusText: string;
  serverError: string;
  feedback: string;
  displayName: string;
  avatar: string;
  screen: "HOME" | "LOBBY" | "GAME" | "ROUND_RESULTS" | "GAME_RESULTS";
  room: RoomSnapshot | null;
  playerId: string;
  players: MockPlayer[];
  scoredPlayers: ScoredPlayerView[];
  chat: ChatEntry[];
  settings: GameSettings;
  game: MockGameSession | null;
  results: FinalGameResults | null;
  correctPlayerIds: string[];
  currentGuessScore: GuessScoreBreakdown | null;
  drawerBonus: number;
  now: number;
  setDisplayName: (value: string) => void;
  setAvatar: (value: string) => void;
  createRoom: () => void;
  joinRoom: (roomCode: string) => void;
  changeSetting: (setting: keyof GameSettings, value: number | string) => void;
  startGame: () => void;
  nextRound: () => void;
  returnHome: () => void;
  returnLobby: () => void;
  playAgain: () => void;
  selectWord: (optionIndex: number) => void;
  submitGuess: (guess: string) => void;
  sendChat: (text: string) => void;
  sendReaction: (reaction: string) => void;
  addStroke: (stroke: DrawingStroke) => void;
  drawingAction: (type: "undo" | "redo" | "clear") => void;
  kickPlayer: (playerId: string) => void;
  randomizeAvatar: () => void;
  homeErrors: { name?: string; roomCode?: string };
  validateName: () => boolean;
  validateAndJoin: (roomCode: string) => boolean;
  clearServerError: () => void;
}

const AVATARS = [
  "😎",
  "🤖",
  "👻",
  "🐸",
  "🦊",
  "🐼",
  "🐱",
  "🦄",
  "🦖",
  "🐙",
  "🐝",
  "🦉",
  "🐧",
  "🦋",
  "🐲",
  "🧢",
];
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const DEFAULT_SETTINGS: GameSettings = {
  rounds: 3,
  drawSeconds: 60,
  wordChoices: 3,
  hints: 2,
  mode: "Normal",
};

const SESSION_STORAGE_KEY = "doodlerush_guest_session";

interface SavedSession {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

function readSavedSession(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSavedSession(session: SavedSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore quota errors
  }
}

function clearSavedSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useRealtimeGame(): RealtimeGameView {
  const socketRef = useRef<RealtimeSocket | null>(null);
  const queuedAction = useRef<(() => void) | null>(null);
  const playerIdRef = useRef("");
  const roomRef = useRef<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("😎");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [privateWord, setPrivateWord] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<{
    answer: string;
    drawerId: string;
    strokes: DrawingStroke[];
    correctPlayerIds: string[];
    drawerBonus: number;
  } | null>(null);
  const [currentGuessScore, setCurrentGuessScore] = useState<GuessScoreBreakdown | null>(null);
  const [results, setResults] = useState<FinalGameResults | null>(null);
  const [serverError, setServerError] = useState(
    process.env.NEXT_PUBLIC_SOCKET_URL
      ? ""
      : "Realtime server is not configured. Set NEXT_PUBLIC_SOCKET_URL and reload.",
  );
  const [homeErrors, setHomeErrors] = useState<{ name?: string; roomCode?: string }>({});
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(0);
  const [serverClockOffset, setServerClockOffset] = useState(0);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
    if (!socketUrl) return;
    const socket: RealtimeSocket = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      setServerError("");

      // Attempt guest session recovery if an active session exists
      const saved = readSavedSession();
      if (saved) {
        socket.emit("session:reconnect", {
          roomCode: saved.roomCode,
          sessionToken: saved.sessionToken,
        });
      }

      const action = queuedAction.current;
      queuedAction.current = null;
      action?.();
    });

    socket.on("disconnect", (reason) => {
      setConnected(false);
      if (reason === "io client disconnect") {
        clearSavedSession();
        setRoom(null);
        setPlayerId("");
      }
      // For network interruptions, do NOT immediately clear room or playerId;
      // allow reconnect grace period to restore state when connection recovers.
    });

    socket.on("connect_error", () => {
      setConnected(false);
      // Only reset view if user was not in a room session
      if (!readSavedSession()) {
        setRoom(null);
        setPlayerId("");
        setServerError("Could not connect to the room server. Check that it is running.");
      }
    });

    socket.on("room:created", ({ roomCode, playerId: newPlayerId, sessionToken }) => {
      setPlayerId(newPlayerId);
      writeSavedSession({ roomCode, playerId: newPlayerId, sessionToken });
    });

    socket.on("room:joined", ({ roomCode, playerId: joinedPlayerId, sessionToken }) => {
      setPlayerId(joinedPlayerId);
      writeSavedSession({ roomCode, playerId: joinedPlayerId, sessionToken });
    });

    socket.on("session:restored", ({ roomCode, playerId: restoredPlayerId, sessionToken }) => {
      setPlayerId(restoredPlayerId);
      writeSavedSession({ roomCode, playerId: restoredPlayerId, sessionToken });
      setServerError("");
      setFeedback("Reconnected to room!");
    });

    socket.on("room:state", (snapshot) => {
      setRoom(snapshot);
      setServerClockOffset(snapshot.serverNow - Date.now());

      // Sync display name and avatar from snapshot if present
      const current = snapshot.players.find((p) => p.id === playerIdRef.current);
      if (current) {
        setDisplayName(current.displayName);
        setAvatar(current.avatarId);
      }

      if (snapshot.state === "LOBBY") {
        setRoundResult(null);
        setResults(null);
        setCurrentGuessScore(null);
        setWordOptions([]);
        setPrivateWord(null);
      }
    });

    socket.on("word:selection", ({ options }) => setWordOptions(options));

    socket.on("round:started", (payload) => {
      setRoundResult(null);
      setCurrentGuessScore(null);
      if (payload.secretWord) setPrivateWord(payload.secretWord);
      setFeedback("");
    });

    socket.on("guess:result", (payload) => {
      if (payload.playerId !== playerIdRef.current) return;
      if (payload.correct && payload.scoreBreakdown) {
        setCurrentGuessScore(payload.scoreBreakdown);
        setFeedback(`Correct! +${payload.pointsAwarded} points · streak ×${payload.streak}`);
      } else if (!payload.correct) {
        setFeedback("Not quite — keep guessing!");
      }
    });

    socket.on("round:ended", (payload) => {
      setRoundResult({
        answer: payload.answer,
        drawerId: payload.drawerId,
        strokes: payload.strokes,
        correctPlayerIds: payload.correctPlayerIds,
        drawerBonus: payload.drawerBonus,
      });
      setPrivateWord(null);
      setWordOptions([]);
    });

    socket.on("game:ended", (gameResults) => setResults(gameResults));

    socket.on("error", ({ code, message }) => {
      if (
        code === "INVALID_SESSION" ||
        code === "ROOM_UNAVAILABLE" ||
        code === "KICKED" ||
        code === "SESSION_EXPIRED"
      ) {
        clearSavedSession();
        setRoom(null);
        setPlayerId("");
      }
      setServerError(message);
    });

    const firstClockUpdate = window.setTimeout(() => setNow(Date.now()), 0);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearTimeout(firstClockUpdate);
      window.clearInterval(clock);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((action: () => void) => {
    const socket = socketRef.current;
    if (!socket) {
      setServerError("Realtime server is not configured. Set NEXT_PUBLIC_SOCKET_URL and reload.");
      return;
    }
    if (socket.connected) action();
    else {
      queuedAction.current = action;
      socket.connect();
    }
  }, []);

  const validateName = useCallback(() => {
    const cleaned = displayName.trim();
    if (!cleaned) {
      setHomeErrors({ name: "Add a name before jumping in." });
      return false;
    }
    if (cleaned.length > 20) {
      setHomeErrors({ name: "Keep your name to 20 characters or fewer." });
      return false;
    }
    setDisplayName(cleaned);
    setHomeErrors({});
    return true;
  }, [displayName]);

  const createRoom = useCallback(() => {
    if (!validateName()) return;
    send(() =>
      socketRef.current?.emit("room:create", { displayName: displayName.trim(), avatarId: avatar }),
    );
  }, [avatar, displayName, send, validateName]);

  const validateAndJoin = useCallback(
    (rawRoomCode: string) => {
      if (!validateName()) return false;
      const roomCode = rawRoomCode.trim().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(roomCode)) {
        setHomeErrors({ roomCode: "Enter an 8-character room code." });
        return false;
      }
      setHomeErrors({});
      send(() =>
        socketRef.current?.emit("room:join", {
          roomCode,
          displayName: displayName.trim(),
          avatarId: avatar,
        }),
      );
      return true;
    },
    [avatar, displayName, send, validateName],
  );

  const players = useMemo<MockPlayer[]>(
    () =>
      (room?.players ?? []).map((player) => ({
        id: player.id,
        name: player.displayName,
        avatar: player.avatarId,
        isReady: player.connected,
        streak: player.streak,
      })),
    [room],
  );
  const scoredPlayers = useMemo<ScoredPlayerView[]>(
    () =>
      (room?.players ?? []).map((player) => ({
        id: player.id,
        name: player.displayName,
        avatar: player.avatarId,
        isReady: player.connected,
        streak: player.streak,
        score: player.score,
      })),
    [room],
  );
  const chat = useMemo<ChatEntry[]>(
    () =>
      (room?.chat ?? []).map((message) => ({
        id: message.id,
        kind: message.kind,
        playerId: message.playerId ?? undefined,
        playerName: message.displayName,
        text: message.text,
      })),
    [room],
  );
  const settings: GameSettings = room
    ? {
        rounds: room.settings.rounds,
        drawSeconds: room.settings.roundDurationSeconds,
        wordChoices: room.settings.wordChoices,
        hints: room.settings.hints,
        mode: room.settings.mode,
      }
    : DEFAULT_SETTINGS;
  const publicGame = room?.game ?? null;
  const serverNow = now + serverClockOffset;
  const secondsLeft = publicGame?.endsAt
    ? Math.max(0, Math.ceil((publicGame.endsAt - serverNow) / 1000))
    : 0;
  const phase = (publicGame?.phase ?? "LOBBY") as UiGamePhase;
  const game: MockGameSession | null = publicGame
    ? {
        phase,
        roundNumber: publicGame.roundNumber,
        totalRounds: publicGame.totalRounds,
        drawerId: publicGame.drawerId ?? "",
        countdown: 0,
        secondsLeft,
        answer: playerId === publicGame.drawerId ? privateWord : null,
        wordOptions: playerId === publicGame.drawerId ? wordOptions : [],
        revealedPositions: publicGame.revealedPositions,
        strokes: publicGame.strokes,
        redoStrokes: [],
        result: roundResult
          ? {
              answer: roundResult.answer,
              drawerId: roundResult.drawerId,
              pointsForCurrentPlayer: currentGuessScore,
              drawerBonusForCurrentPlayer:
                roundResult.drawerId === playerId ? roundResult.drawerBonus : 0,
            }
          : null,
        lastUserPoints: currentGuessScore,
      }
    : null;
  const screen: RealtimeGameView["screen"] = !room
    ? "HOME"
    : room.state === "GAME_RESULTS" && results
      ? "GAME_RESULTS"
      : room.state === "ROUND_RESULTS" && roundResult
        ? "ROUND_RESULTS"
        : room.state === "LOBBY"
          ? "LOBBY"
          : "GAME";
  const statusText = connected
    ? "Connected to room server"
    : room
      ? "Reconnecting to room…"
      : "Connecting to room server…";

  return {
    connected,
    statusText,
    serverError,
    feedback,
    displayName,
    avatar,
    screen,
    room,
    playerId,
    players,
    scoredPlayers,
    chat,
    settings,
    game,
    results,
    correctPlayerIds: roundResult?.correctPlayerIds ?? publicGame?.correctPlayerIds ?? [],
    currentGuessScore,
    drawerBonus: roundResult?.drawerBonus ?? 0,
    now,
    setDisplayName: (value) => {
      setDisplayName(value);
      setHomeErrors((current) => ({ ...current, name: undefined }));
    },
    setAvatar,
    createRoom,
    joinRoom: (roomCode) => {
      validateAndJoin(roomCode);
    },
    changeSetting: (setting, value) => {
      if (!room) return;
      const field = setting === "drawSeconds" ? "roundDurationSeconds" : setting;
      send(() => socketRef.current?.emit("settings:change", { settings: { [field]: value } }));
    },
    startGame: () => send(() => socketRef.current?.emit("game:start")),
    nextRound: () => send(() => socketRef.current?.emit("game:next")),
    returnHome: () => {
      clearSavedSession();
      send(() => socketRef.current?.emit("room:leave"));
      setRoom(null);
      setPlayerId("");
      setRoundResult(null);
      setResults(null);
    },
    returnLobby: () => send(() => socketRef.current?.emit("game:return-lobby")),
    playAgain: () => send(() => socketRef.current?.emit("game:rematch")),
    selectWord: (optionIndex) =>
      send(() => socketRef.current?.emit("word:select", { optionIndex })),
    submitGuess: (guess) => send(() => socketRef.current?.emit("guess:submit", { guess })),
    sendChat: (text) => send(() => socketRef.current?.emit("chat:send", { text })),
    sendReaction: (reaction) => send(() => socketRef.current?.emit("reaction:send", { reaction })),
    addStroke: (stroke) =>
      send(() => socketRef.current?.emit("drawing:update", { type: "add", stroke })),
    drawingAction: (type) => send(() => socketRef.current?.emit("drawing:update", { type })),
    kickPlayer: (targetId) =>
      send(() => socketRef.current?.emit("player:kick", { playerId: targetId })),
    randomizeAvatar: () =>
      setAvatar(
        AVATARS.filter((value) => value !== avatar)[
          Math.floor(Math.random() * (AVATARS.length - 1))
        ] ?? AVATARS[0],
      ),
    homeErrors,
    validateName,
    validateAndJoin,
    clearServerError: () => setServerError(""),
  };
}
