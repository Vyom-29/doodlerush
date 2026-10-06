import { randomInt, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import { isIP } from "node:net";
import {
  addPlayerPoints,
  calculateFinalResults,
  calculateGuessScore,
  createGameStats,
  endRound,
  getCorrectGuesserIds,
  getPlayerScore,
  getRevealedPositions,
  getWordChoices,
  normalizeGuess,
  recordGuess,
  recordHint,
  recordReaction,
  registerPlayer,
  setDrawingStrokeCount,
  startRound,
  type FinalGameResults,
  type GameStats,
} from "@doodlerush/game-engine";
import {
  GameState,
  type ChatMessage,
  type ClientToServerEvents,
  type DrawingCommand,
  type DrawingStroke,
  type InterServerEvents,
  type PlayerId,
  type PlayerSummary,
  type PublicGameState,
  type RoomCode,
  type RoomSettings,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SocketData,
} from "@doodlerush/shared";
import { Server, type Socket } from "socket.io";
import { validateAllowedOrigins } from "./config.js";
import { AddressRateLimiter } from "./address-rate-limiter.js";
import { GuestSessionStore } from "./session-store.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 8;
const DEFAULT_MAX_CONNECTIONS = 256;
const DEFAULT_MAX_ROOMS = 128;
const MAX_ROOM_CREATES_PER_ADDRESS = 30;
const MAX_ROOM_JOINS_PER_ADDRESS = 60;
const MAX_ROOM_RECONNECTS_PER_ADDRESS = 60;
const ADDRESS_RATE_WINDOW_MS = 60_000;
const DEFAULT_RECONNECT_GRACE_MS = 30_000;
const DEFAULT_ROOM_INACTIVITY_TTL_MS = 30 * 60 * 1000;
const AVATARS = new Set([
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
]);
const REACTIONS = new Set(["😂", "🔥", "😭", "👏", "💀", "🤯"]);
const COLORS = new Set([
  "#263b5b",
  "#ef6d5c",
  "#ec9d42",
  "#67b7a7",
  "#5c83cd",
  "#a077c9",
  "#262626",
  "#ffffff",
]);
const MAX_DRAWING_STROKES = 40;
const MAX_POINTS_PER_STROKE = 400;
const MAX_DRAWING_POINTS = 4_000;
const MAX_CHAT_LENGTH = 140;
const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 3,
  roundDurationSeconds: 60,
  maxPlayers: 8,
  wordChoices: 3,
  hints: 2,
  mode: "Normal",
};

interface ConnectedPlayer {
  id: PlayerId;
  socketId: string;
  sessionToken: string;
  displayName: string;
  avatarId: string;
  connected: boolean;
  graceTimer?: ReturnType<typeof setTimeout>;
}

interface InternalGame {
  phase: GameState;
  roundNumber: number;
  totalRounds: number;
  playerOrder: PlayerId[];
  drawerId: PlayerId | null;
  secretWord: string | null;
  wordOptions: string[];
  startsAt: number | null;
  endsAt: number | null;
  wordSelectionEndsAt: number | null;
  revealedPositions: number[];
  strokes: DrawingStroke[];
  redoStrokes: DrawingStroke[];
  correctPlayerIds: Set<PlayerId>;
  streaks: Map<PlayerId, number>;
  stats: GameStats;
  wordTimer?: ReturnType<typeof setTimeout>;
  roundTimer?: ReturnType<typeof setTimeout>;
  hintTimers: Array<ReturnType<typeof setTimeout>>;
}

interface Room {
  code: RoomCode;
  hostId: PlayerId;
  players: ConnectedPlayer[];
  settings: RoomSettings;
  game: InternalGame | null;
  chat: ChatMessage[];
  lastActiveAt: number;
}

export interface GameServerOptions {
  allowedOrigins: string[];
  maxConnections?: number;
  maxRooms?: number;
  /** Test-only shortening knobs; production uses the room's configured duration. */
  roundDurationOverrideMs?: number;
  wordSelectionDurationMs?: number;
  reconnectGraceMs?: number;
  sessionTtlMs?: number;
  roomInactivityTtlMs?: number;
  trustProxy?: boolean;
  now?: () => number;
  roomCode?: () => RoomCode;
}

export interface GameServer {
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  close(): Promise<void>;
  getRoomSnapshot(code: RoomCode): RoomSnapshot | undefined;
  getRoomStats(code: RoomCode): GameStats | undefined;
  getSessionCount(): number;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function createGameServer(httpServer: HttpServer, options: GameServerOptions): GameServer {
  const allowedOrigins = validateAllowedOrigins(
    options.allowedOrigins,
    process.env.NODE_ENV === "production",
  );
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  if (!Number.isInteger(maxConnections) || maxConnections < 1) {
    throw new Error("maxConnections must be a positive integer.");
  }
  if (!Number.isInteger(maxRooms) || maxRooms < 1) {
    throw new Error("maxRooms must be a positive integer.");
  }

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: { origin: allowedOrigins },
      maxHttpBufferSize: 64 * 1024,
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        const allowedOrigin = Boolean(origin && allowedOrigins.includes(origin));
        callback(null, allowedOrigin && io.engine.clientsCount < maxConnections);
      },
    },
  );
  const rooms = new Map<RoomCode, Room>();
  const addressLimiter = new AddressRateLimiter();
  const now = options.now ?? Date.now;
  const wordSelectionDurationMs = options.wordSelectionDurationMs ?? 20_000;
  const reconnectGraceMs =
    options.reconnectGraceMs !== undefined ? options.reconnectGraceMs : DEFAULT_RECONNECT_GRACE_MS;
  const roomInactivityTtlMs = options.roomInactivityTtlMs ?? DEFAULT_ROOM_INACTIVITY_TTL_MS;
  const trustProxy = options.trustProxy ?? false;
  const sessionStore = new GuestSessionStore({
    ttlMs: options.sessionTtlMs,
    now,
  });

  const maintenanceInterval = setInterval(() => {
    const currentTime = now();
    sessionStore.pruneExpired(currentTime);
    for (const [code, room] of rooms) {
      if (currentTime - room.lastActiveAt > roomInactivityTtlMs) {
        destroyRoom(code);
      } else if (
        room.players.every((entry) => !entry.connected) &&
        !room.players.some((p) => Boolean(p.graceTimer))
      ) {
        destroyRoom(code);
      }
    }
  }, 30_000);
  maintenanceInterval.unref?.();

  const handleHttpRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const rawUrl = req.url ?? "/";
    const pathname = rawUrl.split("?")[0];
    if (pathname === "/health" || pathname === "/healthz") {
      if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        if (req.method === "GET") {
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          res.end();
        }
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
      }
      return;
    }
    if (!pathname.startsWith("/socket.io/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    }
  };
  httpServer.on("request", handleHttpRequest);

  function getClientIp(socket: GameSocket): string {
    if (trustProxy) {
      const forwarded = socket.handshake.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.trim()) {
        const firstIp = forwarded.split(",")[0]?.trim();
        if (firstIp && isIP(firstIp) !== 0) {
          return firstIp;
        }
      }
    }
    return socket.handshake.address;
  }

  io.on("connection", (socket) => {
    socket.data.playerId = randomUUID();
    socket.data.limits = {};

    socket.on("room:create", (payload) => {
      if (!allow(socket, "room:create", 4, 10_000)) return;
      if (
        !addressLimiter.allow(
          getClientIp(socket),
          "room:create",
          MAX_ROOM_CREATES_PER_ADDRESS,
          ADDRESS_RATE_WINDOW_MS,
        )
      ) {
        return fail(
          socket,
          "RATE_LIMITED",
          "You are creating rooms too quickly. Try again shortly.",
        );
      }
      if (!hasExactKeys(payload, ["displayName", "avatarId"])) {
        return fail(socket, "INVALID_PAYLOAD", "Room details are invalid.");
      }
      const profile = readProfile(payload);
      if (!profile) return fail(socket, "INVALID_PROFILE", "Enter a valid name and avatar.");
      if (socket.data.roomCode)
        return fail(socket, "ALREADY_IN_ROOM", "Leave your current room first.");
      if (rooms.size >= maxRooms) {
        return fail(socket, "ROOM_CAPACITY", "The room service is full. Try again shortly.");
      }

      let code = (options.roomCode ?? createRoomCode)();
      while (rooms.has(code)) code = createRoomCode();

      const session = sessionStore.createSession(
        socket.data.playerId,
        code,
        profile.displayName,
        profile.avatarId,
      );
      const player: ConnectedPlayer = {
        ...profile,
        id: socket.data.playerId,
        socketId: socket.id,
        sessionToken: session.token,
        connected: true,
      };
      const room: Room = {
        code,
        hostId: player.id,
        players: [player],
        settings: { ...DEFAULT_SETTINGS },
        game: null,
        chat: [],
        lastActiveAt: now(),
      };
      rooms.set(code, room);
      socket.data.roomCode = code;
      socket.data.sessionToken = session.token;
      void socket.join(code);
      socket.emit("room:created", {
        roomCode: code,
        playerId: player.id,
        sessionToken: session.token,
      });
      publishRoom(room);
    });

    socket.on("room:join", (payload) => {
      if (!allow(socket, "room:join", 6, 10_000)) return;
      if (
        !addressLimiter.allow(
          getClientIp(socket),
          "room:join",
          MAX_ROOM_JOINS_PER_ADDRESS,
          ADDRESS_RATE_WINDOW_MS,
        )
      ) {
        return fail(
          socket,
          "RATE_LIMITED",
          "You are joining rooms too quickly. Try again shortly.",
        );
      }
      if (!hasExactKeys(payload, ["roomCode", "displayName", "avatarId"])) {
        return fail(socket, "INVALID_PAYLOAD", "Room details are invalid.");
      }
      const code = typeof payload.roomCode === "string" ? payload.roomCode.toUpperCase() : "";
      const profile = readProfile(payload);
      if (!profile || !/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
        return fail(socket, "INVALID_PAYLOAD", "Enter a valid name and 8-character room code.");
      }
      if (socket.data.roomCode)
        return fail(socket, "ALREADY_IN_ROOM", "Leave your current room first.");
      const room = rooms.get(code);
      if (!room || room.game || room.players.length >= room.settings.maxPlayers) {
        return fail(socket, "ROOM_UNAVAILABLE", "That room code is invalid or unavailable.");
      }
      const session = sessionStore.createSession(
        socket.data.playerId,
        room.code,
        profile.displayName,
        profile.avatarId,
      );
      const player: ConnectedPlayer = {
        ...profile,
        id: socket.data.playerId,
        socketId: socket.id,
        sessionToken: session.token,
        connected: true,
      };
      room.players.push(player);
      room.lastActiveAt = now();
      socket.data.roomCode = room.code;
      socket.data.sessionToken = session.token;
      void socket.join(room.code);
      socket.emit("room:joined", {
        roomCode: room.code,
        playerId: player.id,
        sessionToken: session.token,
      });
      io.to(room.code).emit("player:joined", { player: toPlayerSummary(room, player) });
      publishRoom(room);
    });

    socket.on("session:reconnect", (payload) => {
      if (!allow(socket, "session:reconnect", 10, 10_000)) return;
      if (
        !addressLimiter.allow(
          getClientIp(socket),
          "session:reconnect",
          MAX_ROOM_RECONNECTS_PER_ADDRESS,
          ADDRESS_RATE_WINDOW_MS,
        )
      ) {
        return fail(socket, "RATE_LIMITED", "You are reconnecting too quickly. Try again shortly.");
      }
      if (!hasExactKeys(payload, ["roomCode", "sessionToken"])) {
        return fail(socket, "INVALID_PAYLOAD", "Session reconnect details are invalid.");
      }
      const code = typeof payload.roomCode === "string" ? payload.roomCode.toUpperCase() : "";
      const token = typeof payload.sessionToken === "string" ? payload.sessionToken : "";
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code) || !token) {
        return fail(socket, "INVALID_PAYLOAD", "Invalid room code or session token.");
      }
      if (socket.data.roomCode) {
        return fail(socket, "ALREADY_IN_ROOM", "Leave your current room first.");
      }

      const session = sessionStore.getSession(token);
      if (!session || session.roomCode !== code) {
        return fail(socket, "INVALID_SESSION", "Your session is invalid or expired.");
      }

      const room = rooms.get(code);
      if (!room) {
        sessionStore.deleteSession(token);
        return fail(socket, "ROOM_UNAVAILABLE", "That room is invalid or unavailable.");
      }

      const player = room.players.find((entry) => entry.id === session.playerId);
      if (!player) {
        sessionStore.deleteSession(token);
        return fail(socket, "ROOM_UNAVAILABLE", "That room is invalid or unavailable.");
      }

      // If an existing socket is currently attached, replace it deterministically
      if (player.connected && player.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.socketId) as GameSocket | undefined;
        if (oldSocket) {
          oldSocket.emit("error", {
            code: "SESSION_REPLACED",
            message: "A new connection was established for this session.",
          });
          void oldSocket.leave(room.code);
          delete oldSocket.data.roomCode;
          delete oldSocket.data.sessionToken;
          setTimeout(() => {
            oldSocket.disconnect(true);
          }, 20).unref?.();
        }
      }

      // Cancel pending grace timer
      if (player.graceTimer) {
        clearTimeout(player.graceTimer);
        player.graceTimer = undefined;
      }

      // Restore player connection
      player.connected = true;
      player.socketId = socket.id;
      socket.data.playerId = player.id;
      socket.data.roomCode = room.code;
      socket.data.sessionToken = session.token;
      room.lastActiveAt = now();
      void socket.join(room.code);

      socket.emit("session:restored", {
        roomCode: room.code,
        playerId: player.id,
        sessionToken: session.token,
      });

      // Synchronize authoritative state
      publishRoom(room);

      // Restore drawer private state if currently the active drawer
      if (room.game) {
        if (room.game.phase === GameState.WordSelection && room.game.drawerId === player.id) {
          socket.emit("word:selection", {
            options: [...room.game.wordOptions],
            deadline: room.game.wordSelectionEndsAt ?? now(),
          });
        } else if (
          room.game.phase === GameState.Drawing &&
          room.game.drawerId === player.id &&
          room.game.secretWord
        ) {
          socket.emit("round:started", {
            roundNumber: room.game.roundNumber,
            totalRounds: room.game.totalRounds,
            drawerId: player.id,
            startsAt: room.game.startsAt ?? now(),
            endsAt: room.game.endsAt ?? now(),
            durationSeconds: room.settings.roundDurationSeconds,
            wordLength: [...room.game.secretWord].filter((l) => l !== " ").length,
            secretWord: room.game.secretWord,
          });
        }
      }

      appendSystemChat(room, `${player.displayName} returned to the game.`);
    });

    socket.on("room:leave", (...payload: unknown[]) => {
      if (payload.length)
        return fail(socket, "INVALID_PAYLOAD", "Leave does not accept a payload.");
      leaveRoomVoluntarily(socket);
    });

    socket.on("settings:change", (payload) => {
      if (!allow(socket, "settings:change", 12, 10_000)) return;
      const room = requireRoom(socket);
      if (!room) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can change settings.");
      if (room.game)
        return fail(socket, "GAME_IN_PROGRESS", "Settings cannot change during a game.");
      if (!hasExactKeys(payload, ["settings"]) || !isRecord(payload.settings)) {
        return fail(socket, "INVALID_PAYLOAD", "Settings payload is invalid.");
      }
      const updated = validateSettings(room.settings, payload.settings);
      if (!updated)
        return fail(socket, "INVALID_SETTINGS", "One or more settings are not allowed.");
      room.settings = updated;
      room.lastActiveAt = now();
      io.to(room.code).emit("settings:updated", { settings: room.settings });
      publishRoom(room);
    });

    socket.on("player:kick", (payload) => {
      if (!allow(socket, "player:kick", 5, 10_000)) return;
      const room = requireRoom(socket);
      if (!room) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can remove a player.");
      if (!hasExactKeys(payload, ["playerId"]) || typeof payload.playerId !== "string") {
        return fail(socket, "INVALID_PAYLOAD", "Player identity is invalid.");
      }
      if (payload.playerId === room.hostId)
        return fail(socket, "INVALID_ACTION", "The host cannot remove themselves.");
      const target = room.players.find((player) => player.id === payload.playerId);
      if (!target) return fail(socket, "PLAYER_NOT_FOUND", "That player is not in this room.");
      if (room.game) {
        return fail(socket, "GAME_IN_PROGRESS", "Players cannot be removed after a game starts.");
      }
      if (target.graceTimer) {
        clearTimeout(target.graceTimer);
        target.graceTimer = undefined;
      }
      sessionStore.deleteSession(target.sessionToken);
      room.players = room.players.filter((player) => player.id !== target.id);
      room.lastActiveAt = now();

      const targetSocket = io.sockets.sockets.get(target.socketId) as GameSocket | undefined;
      if (targetSocket) {
        targetSocket.emit("error", {
          code: "KICKED",
          message: "The host removed you from the room.",
        });
        void targetSocket.leave(room.code);
        delete targetSocket.data.roomCode;
        delete targetSocket.data.sessionToken;
      }
      io.to(room.code).emit("player:left", { playerId: target.id });
      publishRoom(room);
    });

    socket.on("game:start", (...payload: unknown[]) => {
      if (!allow(socket, "game:start", 4, 10_000)) return;
      if (payload.length)
        return fail(socket, "INVALID_PAYLOAD", "Start does not accept a payload.");
      const room = requireRoom(socket);
      if (!room) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can start the game.");
      if (room.game) return fail(socket, "INVALID_PHASE", "A game is already running.");
      const connected = room.players.filter((player) => player.connected);
      if (connected.length < 2)
        return fail(socket, "NOT_ENOUGH_PLAYERS", "At least two players are needed.");
      const playerIds = connected.map((player) => player.id);
      const stats = playerIds.reduce(
        (current, id) => registerPlayer(current, id),
        createGameStats(),
      );
      room.lastActiveAt = now();
      room.game = {
        phase: GameState.WordSelection,
        roundNumber: 1,
        totalRounds: room.settings.rounds,
        playerOrder: playerIds,
        drawerId: null,
        secretWord: null,
        wordOptions: [],
        startsAt: null,
        endsAt: null,
        wordSelectionEndsAt: null,
        revealedPositions: [],
        strokes: [],
        redoStrokes: [],
        correctPlayerIds: new Set(),
        streaks: new Map(playerIds.map((id) => [id, 0])),
        stats,
        hintTimers: [],
      };
      io.to(room.code).emit("game:started", { totalRounds: room.settings.rounds });
      beginWordSelection(room);
    });

    socket.on("word:select", (payload) => {
      if (!allow(socket, "word:select", 5, 5_000)) return;
      const room = requireRoom(socket);
      if (!room?.game) return;
      const game = room.game;
      if (game.phase !== GameState.WordSelection || game.drawerId !== socket.data.playerId) {
        return fail(socket, "DRAWER_ONLY", "Only the active drawer can select a word.");
      }
      if (game.wordSelectionEndsAt !== null && now() >= game.wordSelectionEndsAt) {
        beginDrawing(room, game.wordOptions[0] ?? "ROCKET");
        return fail(
          socket,
          "WORD_SELECTION_EXPIRED",
          "The selection timer expired; the first word was chosen.",
        );
      }
      if (!hasExactKeys(payload, ["optionIndex"]) || !Number.isInteger(payload.optionIndex)) {
        return fail(socket, "INVALID_PAYLOAD", "Choose one of the available words.");
      }
      const word = game.wordOptions[payload.optionIndex as number];
      if (!word) return fail(socket, "INVALID_WORD", "That word choice is not available.");
      room.lastActiveAt = now();
      beginDrawing(room, word);
    });

    socket.on("guess:submit", (payload) => {
      if (!allow(socket, "guess:submit", 8, 5_000)) return;
      const room = requireRoom(socket);
      if (!room?.game) return;
      const game = room.game;
      if (game.phase !== GameState.Drawing || !game.secretWord || game.endsAt === null) {
        return fail(socket, "INVALID_PHASE", "There is no active guess round.");
      }
      if (now() >= game.endsAt) {
        finishRound(room);
        return fail(socket, "ROUND_ENDED", "The round timer has expired.");
      }
      if (
        !hasExactKeys(payload, ["guess"]) ||
        typeof payload.guess !== "string" ||
        payload.guess.length > 40
      ) {
        return fail(socket, "INVALID_GUESS", "Guesses must be 1 to 40 characters.");
      }
      const player = getConnectedPlayer(room, socket);
      if (!player) return fail(socket, "NOT_IN_ROOM", "You are not an active room player.");
      if (player.id === game.drawerId)
        return fail(socket, "DRAWER_CANNOT_GUESS", "The drawer cannot submit a guess.");
      if (game.correctPlayerIds.has(player.id)) {
        return fail(socket, "ALREADY_GUESSED", "You already guessed this word correctly.");
      }
      const guess = payload.guess.trim();
      if (!guess) return fail(socket, "INVALID_GUESS", "Type a guess first.");
      const timestamp = now();
      room.lastActiveAt = timestamp;
      const elapsedMs = Math.max(0, timestamp - (game.startsAt ?? timestamp));
      const correct = normalizeGuess(guess) === normalizeGuess(game.secretWord);
      game.stats = recordGuess(game.stats, {
        roundNumber: game.roundNumber,
        playerId: player.id,
        timestamp,
        elapsedMs,
        correct,
      });

      let pointsAwarded = 0;
      let streak = game.streaks.get(player.id) ?? 0;
      let scoreBreakdown: ReturnType<typeof calculateGuessScore> | undefined;
      if (correct) {
        game.correctPlayerIds.add(player.id);
        const remainingSeconds = Math.max(0, (game.endsAt - timestamp) / 1000);
        scoreBreakdown = calculateGuessScore(
          remainingSeconds,
          room.settings.roundDurationSeconds,
          streak,
        );
        pointsAwarded = scoreBreakdown.total;
        streak = scoreBreakdown.streak;
        game.streaks.set(player.id, streak);
        game.stats = addPlayerPoints(game.stats, player.id, pointsAwarded);
      } else {
        streak = 0;
        game.streaks.set(player.id, 0);
      }
      const score = getPlayerScore(game.stats, player.id);
      io.to(room.code).emit("guess:result", {
        playerId: player.id,
        correct,
        pointsAwarded,
        score,
        streak,
        ...(correct ? { elapsedMs } : {}),
        ...(scoreBreakdown ? { scoreBreakdown } : {}),
      });
      appendChat(room, {
        playerId: player.id,
        displayName: player.displayName,
        kind: correct ? "correct" : "guess",
        text: correct ? "guessed correctly!" : guess,
      });
      publishRoom(room);
      if (correct && allGuessersSolved(room)) finishRound(room);
    });

    socket.on("drawing:update", (payload) => {
      if (!allow(socket, "drawing:update", 36, 1_000)) return;
      const room = requireRoom(socket);
      if (!room?.game) return;
      const game = room.game;
      if (game.phase !== GameState.Drawing)
        return fail(socket, "INVALID_PHASE", "Drawing is not active.");
      if (game.endsAt !== null && now() >= game.endsAt) {
        finishRound(room);
        return fail(socket, "ROUND_ENDED", "The round timer has expired.");
      }
      if (game.drawerId !== socket.data.playerId)
        return fail(socket, "DRAWER_ONLY", "Only the active drawer can draw.");
      const command = validateDrawingCommand(
        payload,
        game.strokes.length,
        game.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
      );
      if (!command)
        return fail(socket, "INVALID_DRAWING", "The drawing action is invalid or too large.");
      applyDrawingCommand(game, command);
      room.lastActiveAt = now();
      game.stats = setDrawingStrokeCount(game.stats, game.roundNumber, game.strokes.length);
      io.to(room.code).emit("drawing:updated", {
        playerId: socket.data.playerId,
        operation: command,
        strokes: game.strokes,
        redoCount: game.redoStrokes.length,
      });
      publishRoom(room);
    });

    socket.on("chat:send", (payload) => {
      if (!allow(socket, "chat:send", 5, 10_000)) return;
      const room = requireRoom(socket);
      if (!room) return;
      if (
        !hasExactKeys(payload, ["text"]) ||
        typeof payload.text !== "string" ||
        payload.text.length > MAX_CHAT_LENGTH
      ) {
        return fail(socket, "INVALID_CHAT", "Chat messages must be 1 to 140 characters.");
      }
      const player = getConnectedPlayer(room, socket);
      const text = payload.text
        .trim()
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
      if (!player || !text || text.length > MAX_CHAT_LENGTH) {
        return fail(socket, "INVALID_CHAT", "Chat messages must be 1 to 140 characters.");
      }
      room.lastActiveAt = now();
      appendChat(room, {
        playerId: player.id,
        displayName: player.displayName,
        kind: "chat",
        text,
      });
    });

    socket.on("reaction:send", (payload) => {
      if (!allow(socket, "reaction:send", 4, 2_000)) return;
      const room = requireRoom(socket);
      if (!room?.game || room.game.phase !== GameState.Drawing) {
        return fail(socket, "INVALID_PHASE", "Reactions are available during a drawing round.");
      }
      if (room.game.endsAt !== null && now() >= room.game.endsAt) {
        finishRound(room);
        return fail(socket, "ROUND_ENDED", "The round timer has expired.");
      }
      const player = getConnectedPlayer(room, socket);
      if (!player) return fail(socket, "NOT_IN_ROOM", "You are not an active room player.");
      if (
        !hasExactKeys(payload, ["reaction"]) ||
        typeof payload.reaction !== "string" ||
        !REACTIONS.has(payload.reaction)
      ) {
        return fail(socket, "INVALID_REACTION", "Choose an available reaction.");
      }
      const game = room.game;
      if (player.id === game.drawerId)
        return fail(socket, "DRAWER_CANNOT_REACT", "The drawer cannot react to their own drawing.");
      if (game.stats.rounds.at(-1)?.reactions.some((entry) => entry.playerId === player.id)) {
        return fail(socket, "DUPLICATE_REACTION", "You have already reacted to this drawing.");
      }
      const sentAt = now();
      room.lastActiveAt = sentAt;
      game.stats = recordReaction(game.stats, {
        roundNumber: game.roundNumber,
        playerId: player.id,
        reaction: payload.reaction,
        timestamp: sentAt,
      });
      io.to(room.code).emit("reaction:received", {
        playerId: player.id,
        displayName: player.displayName,
        reaction: payload.reaction,
        sentAt,
      });
    });

    socket.on("game:next", (...payload: unknown[]) => {
      if (!allow(socket, "game:next", 12, 10_000)) return;
      if (payload.length)
        return fail(socket, "INVALID_PAYLOAD", "Advance does not accept a payload.");
      const room = requireRoom(socket);
      if (!room?.game) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can advance the game.");
      if (room.game.phase !== GameState.RoundResults)
        return fail(socket, "INVALID_PHASE", "The round has not ended.");
      room.lastActiveAt = now();
      if (room.game.roundNumber >= room.game.totalRounds) {
        finishGame(room);
      } else {
        room.game.roundNumber += 1;
        beginWordSelection(room);
      }
    });

    socket.on("game:rematch", (...payload: unknown[]) => {
      if (!allow(socket, "game:rematch", 3, 10_000)) return;
      if (payload.length)
        return fail(socket, "INVALID_PAYLOAD", "Rematch does not accept a payload.");
      const room = requireRoom(socket);
      if (!room) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can start a rematch.");
      if (room.game?.phase !== GameState.GameResults)
        return fail(socket, "INVALID_PHASE", "The game is not complete.");
      clearGameTimers(room.game);
      room.game = null;
      room.lastActiveAt = now();
      appendSystemChat(room, "The host opened a new game. Ready when you are!");
    });

    socket.on("game:return-lobby", (...payload: unknown[]) => {
      if (!allow(socket, "game:return-lobby", 3, 10_000)) return;
      if (payload.length)
        return fail(socket, "INVALID_PAYLOAD", "Return-to-lobby does not accept a payload.");
      const room = requireRoom(socket);
      if (!room) return;
      if (!isHost(room, socket))
        return fail(socket, "HOST_ONLY", "Only the host can return the room to its lobby.");
      if (room.game?.phase !== GameState.GameResults)
        return fail(socket, "INVALID_PHASE", "The game is not complete.");
      clearGameTimers(room.game);
      room.game = null;
      room.lastActiveAt = now();
      appendSystemChat(room, "The host returned everyone to the lobby.");
    });

    socket.on("disconnect", () => handleSocketDisconnect(socket));
  });

  return {
    io,
    close: async () => {
      httpServer.off("request", handleHttpRequest);
      clearInterval(maintenanceInterval);
      for (const code of Array.from(rooms.keys())) {
        destroyRoom(code);
      }
      sessionStore.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
    getRoomSnapshot: (code) => {
      const room = rooms.get(code);
      return room ? snapshot(room) : undefined;
    },
    getRoomStats: (code) => rooms.get(code)?.game?.stats,
    getSessionCount: () => sessionStore.size(),
  };

  function createRoomCode(): RoomCode {
    return Array.from(
      { length: ROOM_CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join("");
  }

  function publishRoom(room: Room): void {
    io.to(room.code).emit("room:state", snapshot(room));
  }

  function snapshot(room: Room): RoomSnapshot {
    const game = room.game;
    const publicGame: PublicGameState | null = game
      ? {
          phase: game.phase,
          roundNumber: game.roundNumber,
          totalRounds: game.totalRounds,
          drawerId: game.drawerId,
          startsAt: game.startsAt,
          endsAt: game.phase === GameState.WordSelection ? game.wordSelectionEndsAt : game.endsAt,
          durationSeconds: room.settings.roundDurationSeconds,
          wordLength: game.secretWord
            ? [...game.secretWord].filter((letter) => letter !== " ").length
            : 0,
          maskedWord: game.secretWord
            ? [...game.secretWord].map((letter, index) =>
                letter === " " || game.revealedPositions.includes(index) ? letter : "",
              )
            : [],
          revealedPositions: [...game.revealedPositions],
          strokes: game.strokes,
          redoCount: game.redoStrokes.length,
          correctPlayerIds: [...game.correctPlayerIds],
        }
      : null;
    const players = room.players.map((player) => toPlayerSummary(room, player));
    return {
      code: room.code,
      serverNow: now(),
      hostId: room.hostId,
      players,
      settings: { ...room.settings },
      state: game?.phase ?? GameState.Lobby,
      game: publicGame,
      chat: [...room.chat],
    };
  }

  function toPlayerSummary(room: Room, player: ConnectedPlayer): PlayerSummary {
    return {
      id: player.id,
      displayName: player.displayName,
      avatarId: player.avatarId,
      isHost: player.id === room.hostId,
      score: room.game ? getPlayerScore(room.game.stats, player.id) : 0,
      streak: room.game?.streaks.get(player.id) ?? 0,
      connected: player.connected,
    };
  }

  function requireRoom(socket: GameSocket): Room | undefined {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : undefined;
    if (!room || !getConnectedPlayer(room, socket)) {
      fail(socket, "NOT_IN_ROOM", "Join a room before sending that action.");
      return undefined;
    }
    return room;
  }

  function getConnectedPlayer(room: Room, socket: GameSocket): ConnectedPlayer | undefined {
    return room.players.find(
      (player) =>
        player.id === socket.data.playerId && player.socketId === socket.id && player.connected,
    );
  }

  function isHost(room: Room, socket: GameSocket): boolean {
    return room.hostId === socket.data.playerId && Boolean(getConnectedPlayer(room, socket));
  }

  function beginWordSelection(room: Room): void {
    const game = room.game;
    if (!game) return;
    clearGameTimers(game);
    const connected = game.playerOrder
      .map((id) => room.players.find((player) => player.id === id))
      .filter((player): player is ConnectedPlayer => Boolean(player?.connected));
    if (connected.length < 2) {
      room.game = null;
      appendSystemChat(room, "The game needs two connected players to continue.");
      return;
    }
    const preferred = (game.roundNumber - 1) % game.playerOrder.length;
    const drawer = Array.from(
      { length: game.playerOrder.length },
      (_, offset) => game.playerOrder[(preferred + offset) % game.playerOrder.length],
    )
      .map((id) => room.players.find((player) => player.id === id))
      .find((player): player is ConnectedPlayer => Boolean(player?.connected));
    if (!drawer) return;
    const deadline = now() + wordSelectionDurationMs;
    game.phase = GameState.WordSelection;
    game.drawerId = drawer.id;
    game.secretWord = null;
    game.wordOptions = getWordChoices(game.roundNumber, room.settings.wordChoices);
    game.startsAt = null;
    game.endsAt = null;
    game.wordSelectionEndsAt = deadline;
    game.revealedPositions = [];
    game.strokes = [];
    game.redoStrokes = [];
    game.correctPlayerIds = new Set();
    io.to(drawer.socketId).emit("word:selection", { options: [...game.wordOptions], deadline });
    game.wordTimer = setTimeout(
      () => beginDrawing(room, game.wordOptions[0] ?? "ROCKET"),
      wordSelectionDurationMs,
    );
    game.wordTimer.unref?.();
    publishRoom(room);
  }

  function beginDrawing(room: Room, word: string): void {
    const game = room.game;
    if (!game || game.phase !== GameState.WordSelection || !game.drawerId) return;
    if (game.wordTimer) clearTimeout(game.wordTimer);
    game.wordTimer = undefined;
    const start = now();
    const durationMs =
      options.roundDurationOverrideMs ?? room.settings.roundDurationSeconds * 1_000;
    const end = start + durationMs;
    game.phase = GameState.Drawing;
    game.secretWord = word;
    game.startsAt = start;
    game.endsAt = end;
    game.wordSelectionEndsAt = null;
    game.revealedPositions = [];
    game.strokes = [];
    game.redoStrokes = [];
    game.correctPlayerIds = new Set();
    game.stats = startRound(game.stats, {
      roundNumber: game.roundNumber,
      drawerId: game.drawerId,
      word,
      startedAt: start,
    });
    const publicPayload = {
      roundNumber: game.roundNumber,
      totalRounds: game.totalRounds,
      drawerId: game.drawerId,
      startsAt: start,
      endsAt: end,
      durationSeconds: room.settings.roundDurationSeconds,
      wordLength: [...word].filter((letter) => letter !== " ").length,
    };
    const drawer = room.players.find((player) => player.id === game.drawerId);
    if (drawer) {
      io.to(room.code).except(drawer.socketId).emit("round:started", publicPayload);
      io.to(drawer.socketId).emit("round:started", { ...publicPayload, secretWord: word });
    }
    game.roundTimer = setTimeout(() => finishRound(room), Math.max(0, end - now()));
    game.roundTimer.unref?.();
    const hintCount = Math.min(
      room.settings.hints,
      Math.max(0, [...word].filter((letter) => letter !== " ").length - 2),
    );
    for (let hint = 1; hint <= hintCount; hint += 1) {
      const delay = Math.floor((durationMs * hint) / (hintCount + 1));
      const timer = setTimeout(() => {
        if (room.game !== game || game.phase !== GameState.Drawing || !game.secretWord) return;
        if (game.endsAt !== null && now() >= game.endsAt) {
          finishRound(room);
          return;
        }
        game.revealedPositions = getRevealedPositions(game.secretWord, hint);
        game.stats = recordHint(game.stats, game.roundNumber);
        io.to(room.code).emit("room:state", snapshot(room));
      }, delay);
      timer.unref?.();
      game.hintTimers.push(timer);
    }
    publishRoom(room);
  }

  function finishRound(room: Room): void {
    const game = room.game;
    if (!game || game.phase !== GameState.Drawing || !game.secretWord || !game.drawerId) return;
    clearGameTimers(game);
    const timestamp = now();
    const endedAt = game.endsAt !== null && timestamp >= game.endsAt ? game.endsAt : timestamp;
    game.stats = endRound(game.stats, game.roundNumber, endedAt);
    game.stats = setDrawingStrokeCount(game.stats, game.roundNumber, game.strokes.length);
    game.stats = addPlayerPoints(game.stats, game.drawerId, 100);
    game.phase = GameState.RoundResults;
    const payload = {
      roundNumber: game.roundNumber,
      totalRounds: game.totalRounds,
      answer: game.secretWord,
      drawerId: game.drawerId,
      correctPlayerIds: getCorrectGuesserIds(game.stats, game.roundNumber),
      scores: Object.fromEntries(
        game.stats.playerScores.map((entry) => [entry.playerId, entry.score]),
      ),
      strokes: game.strokes,
      drawerBonus: 100,
    };
    io.to(room.code).emit("round:ended", payload);
    publishRoom(room);
  }

  function finishGame(room: Room): void {
    const game = room.game;
    if (!game || game.phase !== GameState.RoundResults) return;
    const results: FinalGameResults = calculateFinalResults(game.stats);
    game.phase = GameState.GameResults;
    clearGameTimers(game);
    io.to(room.code).emit("game:ended", results);
    publishRoom(room);
  }

  function allGuessersSolved(room: Room): boolean {
    const game = room.game;
    if (!game || !game.drawerId) return false;
    const guessers = room.players.filter(
      (player) => player.connected && player.id !== game.drawerId,
    );
    return guessers.length > 0 && guessers.every((player) => game.correctPlayerIds.has(player.id));
  }

  function appendChat(room: Room, message: Omit<ChatMessage, "id" | "sentAt">): void {
    const saved: ChatMessage = { ...message, id: randomUUID(), sentAt: now() };
    room.chat.push(saved);
    if (room.chat.length > 80) room.chat.splice(0, room.chat.length - 80);
    io.to(room.code).emit("chat:message", saved);
    publishRoom(room);
  }

  function appendSystemChat(room: Room, text: string): void {
    appendChat(room, { playerId: null, displayName: "DoodleRush", kind: "system", text });
  }

  /** Voluntary departure when a player clicks Leave Room / Return Home */
  function leaveRoomVoluntarily(socket: GameSocket): void {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : undefined;
    if (!room) return;
    const player = room.players.find(
      (entry) => entry.id === socket.data.playerId && entry.socketId === socket.id,
    );
    if (!player) return;

    if (player.graceTimer) {
      clearTimeout(player.graceTimer);
      player.graceTimer = undefined;
    }
    sessionStore.deleteSession(player.sessionToken);

    const wasDrawer = room.game?.drawerId === player.id;
    if (!room.game) {
      room.players = room.players.filter((entry) => entry.id !== player.id);
    } else {
      player.connected = false;
    }
    delete socket.data.roomCode;
    delete socket.data.sessionToken;
    void socket.leave(room.code);

    if (room.hostId === player.id) {
      const nextHost = room.players.find((entry) => entry.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
    io.to(room.code).emit("player:left", { playerId: player.id });

    if (room.players.every((entry) => !entry.connected)) {
      destroyRoom(room.code);
      return;
    }
    if (wasDrawer && room.game?.phase === GameState.WordSelection) beginWordSelection(room);
    else if (wasDrawer && room.game?.phase === GameState.Drawing) finishRound(room);
    else if (room.game?.phase === GameState.Drawing && allGuessersSolved(room)) finishRound(room);
    publishRoom(room);
  }

  /** Involuntary network drop or browser tab close. Enters reconnect grace period. */
  function handleSocketDisconnect(socket: GameSocket): void {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : undefined;
    if (!room) return;
    const player = room.players.find(
      (entry) => entry.id === socket.data.playerId && entry.socketId === socket.id,
    );
    if (!player) return;

    player.connected = false;
    room.lastActiveAt = now();

    if (reconnectGraceMs <= 0) {
      handlePlayerGraceExpired(room.code, player.id);
      return;
    }

    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = setTimeout(() => {
      handlePlayerGraceExpired(room.code, player.id);
    }, reconnectGraceMs);
    player.graceTimer.unref?.();

    publishRoom(room);
  }

  function handlePlayerGraceExpired(roomCode: RoomCode, playerId: PlayerId): void {
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find((entry) => entry.id === playerId);
    if (!player || player.connected) return;

    if (player.graceTimer) {
      clearTimeout(player.graceTimer);
      player.graceTimer = undefined;
    }
    sessionStore.deleteSession(player.sessionToken);

    const wasDrawer = room.game?.drawerId === player.id;
    if (!room.game) {
      room.players = room.players.filter((entry) => entry.id !== player.id);
    }

    if (room.hostId === player.id) {
      const nextHost = room.players.find((entry) => entry.connected);
      if (nextHost) room.hostId = nextHost.id;
    }

    io.to(room.code).emit("player:left", { playerId: player.id });

    if (room.players.every((entry) => !entry.connected)) {
      destroyRoom(room.code);
      return;
    }

    if (wasDrawer && room.game?.phase === GameState.WordSelection) beginWordSelection(room);
    else if (wasDrawer && room.game?.phase === GameState.Drawing) finishRound(room);
    else if (room.game?.phase === GameState.Drawing && allGuessersSolved(room)) finishRound(room);

    publishRoom(room);
  }

  function destroyRoom(code: RoomCode): void {
    const room = rooms.get(code);
    if (!room) return;
    if (room.game) clearGameTimers(room.game);
    for (const player of room.players) {
      if (player.graceTimer) {
        clearTimeout(player.graceTimer);
        player.graceTimer = undefined;
      }
    }
    sessionStore.deleteSessionsForRoom(code);
    rooms.delete(code);
  }

  function clearGameTimers(game: InternalGame): void {
    if (game.wordTimer) clearTimeout(game.wordTimer);
    if (game.roundTimer) clearTimeout(game.roundTimer);
    for (const timer of game.hintTimers) clearTimeout(timer);
    game.wordTimer = undefined;
    game.roundTimer = undefined;
    game.hintTimers = [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function readProfile(value: unknown): { displayName: string; avatarId: string } | null {
  if (
    !isRecord(value) ||
    typeof value.displayName !== "string" ||
    typeof value.avatarId !== "string"
  )
    return null;
  const displayName = value.displayName.trim();
  if (!displayName || displayName.length > 20 || !AVATARS.has(value.avatarId)) return null;
  return { displayName, avatarId: value.avatarId };
}

function validateSettings(
  current: RoomSettings,
  input: Record<string, unknown>,
): RoomSettings | null {
  const allowedKeys = new Set([
    "rounds",
    "roundDurationSeconds",
    "maxPlayers",
    "wordChoices",
    "hints",
    "mode",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  const merged = { ...current, ...input };
  if (
    ![3, 5, 7].includes(merged.rounds as number) ||
    ![45, 60, 90].includes(merged.roundDurationSeconds as number) ||
    ![2, 3].includes(merged.wordChoices as number) ||
    ![1, 2].includes(merged.hints as number) ||
    ![4, 6, 8].includes(merged.maxPlayers as number) ||
    !["Normal", "Chill"].includes(merged.mode as string) ||
    (merged.maxPlayers as number) < 2
  )
    return null;
  return merged as RoomSettings;
}

function validateDrawingCommand(
  value: unknown,
  existingStrokeCount: number,
  existingPointCount: number,
): DrawingCommand | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "undo" || value.type === "redo" || value.type === "clear") {
    return hasExactKeys(value, ["type"]) ? { type: value.type } : null;
  }
  if (value.type !== "add" || !hasExactKeys(value, ["type", "stroke"]) || !isRecord(value.stroke))
    return null;
  const stroke = value.stroke;
  if (
    !hasExactKeys(stroke, ["id", "color", "size", "tool", "points"]) ||
    existingStrokeCount >= MAX_DRAWING_STROKES ||
    typeof stroke.id !== "string" ||
    stroke.id.length > 48 ||
    typeof stroke.color !== "string" ||
    !COLORS.has(stroke.color) ||
    typeof stroke.size !== "number" ||
    !Number.isFinite(stroke.size) ||
    stroke.size < 1 ||
    stroke.size > 30 ||
    (stroke.tool !== "pen" && stroke.tool !== "eraser") ||
    !Array.isArray(stroke.points) ||
    stroke.points.length < 1 ||
    stroke.points.length > MAX_POINTS_PER_STROKE ||
    existingPointCount + stroke.points.length > MAX_DRAWING_POINTS
  )
    return null;
  const points = stroke.points.flatMap((point): DrawingStroke["points"] => {
    if (
      !hasExactKeys(point, ["x", "y"]) ||
      typeof point.x !== "number" ||
      typeof point.y !== "number"
    )
      return [];
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      return [];
    return [{ x: point.x, y: point.y }];
  });
  if (points.length !== stroke.points.length) return null;
  return {
    type: "add",
    stroke: {
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      tool: stroke.tool,
      points,
    },
  };
}

function applyDrawingCommand(game: InternalGame, command: DrawingCommand): void {
  if (command.type === "add") {
    if (game.strokes.length >= MAX_DRAWING_STROKES) return;
    game.strokes.push(command.stroke);
    game.redoStrokes = [];
  } else if (command.type === "undo") {
    const stroke = game.strokes.pop();
    if (stroke) game.redoStrokes.push(stroke);
  } else if (command.type === "redo") {
    const stroke = game.redoStrokes.pop();
    if (stroke && game.strokes.length < MAX_DRAWING_STROKES) game.strokes.push(stroke);
  } else {
    game.strokes = [];
    game.redoStrokes = [];
  }
}

function allow(socket: GameSocket, event: string, maximum: number, windowMs: number): boolean {
  const limits = socket.data.limits ?? (socket.data.limits = {});
  const current = limits[event];
  const now = Date.now();
  if (!current || now - current.startedAt >= windowMs) {
    limits[event] = { startedAt: now, count: 1 };
    return true;
  }
  if (current.count >= maximum) {
    socket.emit("error", {
      code: "RATE_LIMITED",
      message: "You are doing that too quickly. Try again shortly.",
    });
    return false;
  }
  current.count += 1;
  return true;
}

function fail(socket: GameSocket, code: string, message: string): void {
  socket.emit("error", { code, message });
}
