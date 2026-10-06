import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, it } from "node:test";
import { io as connectSocket, type Socket as ClientSocket } from "socket.io-client";

import {
  GameState,
  type ClientToServerEvents,
  type RoomSnapshot,
  type ServerToClientEvents,
} from "@doodlerush/shared";
import { createGameServer, type GameServer } from "../src/game-server.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
interface LooseSocket {
  once(event: string, listener: (payload: unknown) => void): this;
  on(event: string, listener: (payload: unknown) => void): this;
  onAny(listener: (eventName: string, payload: unknown) => void): this;
  off(event: string, listener: (payload: unknown) => void): this;
  emit(event: string, payload?: unknown): this;
}

let httpServer: HttpServer;
let gameServer: GameServer;
let clients: TestSocket[];
let url: string;

describe("authoritative multiplayer service", () => {
  beforeEach(async () => {
    httpServer = createServer();
    gameServer = createGameServer(httpServer, {
      allowedOrigins: ["http://localhost"],
      roundDurationOverrideMs: 500,
      wordSelectionDurationMs: 2_000,
      reconnectGraceMs: 0,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to a port.");
    url = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await gameServer.close();
  });

  it("creates rooms, assigns a server identity, joins once, leaves, and isolates rooms", async () => {
    const hostA = await newClient();
    const hostB = await newClient();
    const guest = await newClient();
    const roomA = await createRoom(hostA, "Host A");
    const roomB = await createRoom(hostB, "Host B");
    assert.match(roomA.roomCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(roomA.playerId, "Host A");

    const joined = event<{ roomCode: string; playerId: string }>(guest, "room:joined");
    const hostRoomUpdate = event<RoomSnapshot>(hostA, "room:state");
    guest.emit("room:join", { roomCode: roomA.roomCode, displayName: "Guest", avatarId: "🐼" });
    assert.equal((await joined).playerId.length > 0, true);
    assert.equal((await hostRoomUpdate).players.length, 2);

    const duplicateJoinError = event<{ code: string }>(guest, "error");
    guest.emit("room:join", { roomCode: roomA.roomCode, displayName: "Guest", avatarId: "🐼" });
    assert.equal((await duplicateJoinError).code, "ALREADY_IN_ROOM");

    const roomBState = gameServer.getRoomSnapshot(roomB.roomCode);
    const chatUpdate = event<RoomSnapshot>(hostA, "room:state");
    hostA.emit("chat:send", { text: "Only room A" });
    assert.equal((await chatUpdate).chat.at(-1)?.text, "Only room A");
    assert.equal(gameServer.getRoomSnapshot(roomB.roomCode)?.chat.length, roomBState?.chat.length);

    const crossRoomPayload = event<{ code: string }>(guest, "error");
    emitRaw(guest, "chat:send", { text: "cross-room", roomCode: roomB.roomCode });
    assert.equal((await crossRoomPayload).code, "INVALID_CHAT");
    assert.equal(gameServer.getRoomSnapshot(roomB.roomCode)?.chat.length, roomBState?.chat.length);

    const leftRoomUpdate = event<RoomSnapshot>(hostA, "room:state");
    guest.emit("room:leave");
    assert.equal((await leftRoomUpdate).players.length, 1);
    assert.equal(gameServer.getRoomSnapshot(roomA.roomCode)?.players.length, 1);
  });

  it("enforces host permissions, settings validation, kicking, and minimum players", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host");
    await joinRoom(guest, room.roomCode, "Guest");

    const startError = event<{ code: string }>(guest, "error");
    guest.emit("game:start");
    assert.equal((await startError).code, "HOST_ONLY");
    const settingsError = event<{ code: string }>(guest, "error");
    guest.emit("settings:change", { settings: { rounds: 5 } });
    assert.equal((await settingsError).code, "HOST_ONLY");
    const kickError = event<{ code: string }>(guest, "error");
    guest.emit("player:kick", { playerId: room.playerId });
    assert.equal((await kickError).code, "HOST_ONLY");

    const hostRoomUpdate = event<RoomSnapshot>(host, "room:state");
    host.emit("settings:change", { settings: { rounds: 5 } });
    assert.equal((await hostRoomUpdate).settings.rounds, 5);
    const invalidSettings = event<{ code: string }>(host, "error");
    host.emit("settings:change", { settings: { rounds: 500 } });
    assert.equal((await invalidSettings).code, "INVALID_SETTINGS");
    const nonFiniteSettings = event<{ code: string }>(host, "error");
    emitRaw(host, "settings:change", { settings: { rounds: Number.POSITIVE_INFINITY } });
    assert.equal((await nonFiniteSettings).code, "INVALID_SETTINGS");

    const guestKicked = event<{ code: string }>(guest, "error");
    const hostRoomAfterKick = event<RoomSnapshot>(host, "room:state");
    host.emit("player:kick", {
      playerId: gameServer.getRoomSnapshot(room.roomCode)?.players[1]?.id ?? "",
    });
    assert.equal((await guestKicked).code, "KICKED");
    assert.equal((await hostRoomAfterKick).players.length, 1);

    const minPlayersError = event<{ code: string }>(host, "error");
    host.emit("game:start");
    assert.equal((await minPlayersError).code, "NOT_ENOUGH_PLAYERS");
  });

  it("keeps the word private, authorizes drawing, validates guesses, and records authoritative stats", async () => {
    const host = await newClient();
    const firstGuesser = await newClient();
    const secondGuesser = await newClient();
    const room = await createRoom(host, "Drawer");
    const first = await joinRoom(firstGuesser, room.roomCode, "First");
    const second = await joinRoom(secondGuesser, room.roomCode, "Second");

    const publicSnapshots: RoomSnapshot[] = [];
    const privateSelections: unknown[] = [];
    const guesserEvents: Array<{ eventName: string; payload: unknown }> = [];
    (host as unknown as LooseSocket).on("room:state", (payload) =>
      publicSnapshots.push(payload as RoomSnapshot),
    );
    for (const guesser of [firstGuesser, secondGuesser]) {
      const loose = guesser as unknown as LooseSocket;
      loose.on("room:state", (payload) => publicSnapshots.push(payload as RoomSnapshot));
      loose.onAny((eventName, payload) => guesserEvents.push({ eventName, payload }));
    }
    (firstGuesser as unknown as LooseSocket).on("word:selection", (payload) =>
      privateSelections.push(payload),
    );
    (secondGuesser as unknown as LooseSocket).on("word:selection", (payload) =>
      privateSelections.push(payload),
    );

    const options = event<{ options: string[] }>(host, "word:selection");
    const startedAsDrawer = event<{ secretWord?: string }>(host, "round:started");
    const startedForFirst = event<{ secretWord?: string }>(firstGuesser, "round:started");
    const gameStarted = event<{ totalRounds: number }>(host, "game:started");
    host.emit("game:start");
    assert.equal((await gameStarted).totalRounds, 3);
    const wordOptions = await options;
    const unauthorizedSelection = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("word:select", { optionIndex: 0 });
    assert.equal((await unauthorizedSelection).code, "DRAWER_ONLY");

    const word = wordOptions.options[0];
    assert.ok(word);
    host.emit("word:select", { optionIndex: 0 });
    const drawerRoundEvent = await startedAsDrawer;
    assert.equal(drawerRoundEvent.secretWord, word);
    const guesserRoundEvent = await startedForFirst;
    assert.equal(guesserRoundEvent.secretWord, undefined);
    assert.equal(privateSelections.length, 0);
    assert.ok(publicSnapshots.every((snapshot) => !JSON.stringify(snapshot).includes(word)));
    assert.ok(publicSnapshots.every((snapshot) => !("secretWord" in (snapshot.game ?? {}))));
    assert.ok(guesserEvents.length > 0);
    assert.ok(guesserEvents.every((entry) => !JSON.stringify(entry).includes(word)));

    const wrongDrawing = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("drawing:update", { type: "clear" });
    assert.equal((await wrongDrawing).code, "DRAWER_ONLY");
    const oversizedDrawing = event<{ code: string }>(host, "error");
    host.emit("drawing:update", {
      type: "add",
      stroke: {
        id: "too-many-points",
        color: "#263b5b",
        size: 5,
        tool: "pen",
        points: Array.from({ length: 401 }, () => ({ x: 0.5, y: 0.5 })),
      },
    });
    assert.equal((await oversizedDrawing).code, "INVALID_DRAWING");

    const drawingUpdate = event<{ strokes: Array<{ id: string }> }>(
      firstGuesser,
      "drawing:updated",
    );
    host.emit("drawing:update", {
      type: "add",
      stroke: {
        id: "stroke-a",
        color: "#263b5b",
        size: 5,
        tool: "pen",
        points: [{ x: 0.2, y: 0.3 }],
      },
    });
    assert.equal((await drawingUpdate).strokes[0]?.id, "stroke-a");

    const wrongGuessError = event<{ code: string }>(host, "error");
    host.emit("guess:submit", { guess: "not the word" });
    assert.equal((await wrongGuessError).code, "DRAWER_CANNOT_GUESS");
    const invalidGuessError = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("guess:submit", { guess: " " });
    assert.equal((await invalidGuessError).code, "INVALID_GUESS");
    const oversizedGuessError = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("guess:submit", { guess: "x".repeat(41) });
    assert.equal((await oversizedGuessError).code, "INVALID_GUESS");

    const invalidCoordinate = event<{ code: string }>(host, "error");
    host.emit("drawing:update", {
      type: "add",
      stroke: {
        id: "invalid-coordinate",
        color: "#263b5b",
        size: 5,
        tool: "pen",
        points: [{ x: Number.POSITIVE_INFINITY, y: 0.5 }],
      },
    });
    assert.equal((await invalidCoordinate).code, "INVALID_DRAWING");

    const reactionEvent = event<{ playerId: string }>(host, "reaction:received");
    firstGuesser.emit("reaction:send", { reaction: "🔥" });
    assert.equal((await reactionEvent).playerId, first.playerId);
    const duplicateReaction = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("reaction:send", { reaction: "😂" });
    assert.equal((await duplicateReaction).code, "DUPLICATE_REACTION");

    const wrongGuess = event<{ correct: boolean }>(host, "guess:result");
    firstGuesser.emit("guess:submit", { guess: "definitely wrong" });
    assert.equal((await wrongGuess).correct, false);
    const firstCorrectResult = event<{ playerId: string; correct: boolean; pointsAwarded: number }>(
      host,
      "guess:result",
    );
    firstGuesser.emit("guess:submit", { guess: word.toLowerCase() });
    const correct = await firstCorrectResult;
    assert.equal(correct.correct, true);
    assert.ok(correct.pointsAwarded > 0);
    const repeatedCorrect = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("guess:submit", { guess: word });
    assert.equal((await repeatedCorrect).code, "ALREADY_GUESSED");

    const roundEnded = event<{ answer: string; correctPlayerIds: string[] }>(
      firstGuesser,
      "round:ended",
    );
    secondGuesser.emit("guess:submit", { guess: word });
    const finished = await roundEnded;
    assert.equal(finished.answer, word);
    assert.deepEqual(
      new Set(finished.correctPlayerIds),
      new Set([first.playerId, second.playerId]),
    );
    const stats = gameServer.getRoomStats(room.roomCode);
    assert.equal(stats?.rounds[0]?.correctGuesses.length, 2);
    assert.equal(stats?.rounds[0]?.incorrectGuesses.length, 1);
    assert.equal(stats?.rounds[0]?.reactions.length, 1);
    assert.equal(stats?.rounds[0]?.drawingStats.strokeCount, 1);
    assert.ok(
      (stats?.playerScores.find((score) => score.playerId === first.playerId)?.score ?? 0) > 0,
    );

    const scoreAfterRound = gameServer
      .getRoomSnapshot(room.roomCode)
      ?.players.find((player) => player.id === first.playerId)?.score;
    const lateGuessError = event<{ code: string }>(firstGuesser, "error");
    firstGuesser.emit("guess:submit", { guess: word });
    assert.equal((await lateGuessError).code, "INVALID_PHASE");
    assert.equal(
      gameServer
        .getRoomSnapshot(room.roomCode)
        ?.players.find((player) => player.id === first.playerId)?.score,
      scoreAfterRound,
    );
  });

  it("rejects forged identity and client-authoritative score fields", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host");

    const forgedJoin = event<{ code: string }>(guest, "error");
    emitRaw(guest, "room:join", {
      roomCode: room.roomCode,
      displayName: "Host",
      avatarId: "😎",
      playerId: room.playerId,
    });
    assert.equal((await forgedJoin).code, "INVALID_PAYLOAD");
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.players.length, 1);

    await joinRoom(guest, room.roomCode, "Guest");
    const wordOptions = event<{ options: string[] }>(host, "word:selection");
    const gameStarted = event<{ totalRounds: number }>(host, "game:started");
    host.emit("game:start");
    await gameStarted;
    const word = (await wordOptions).options[0];
    assert.ok(word);
    const started = event<{ secretWord?: string }>(host, "round:started");
    host.emit("word:select", { optionIndex: 0 });
    assert.equal((await started).secretWord, word);

    const forgedGuess = event<{ code: string }>(guest, "error");
    emitRaw(guest, "guess:submit", {
      guess: word,
      playerId: room.playerId,
      score: 999_999,
      correct: true,
    });
    assert.equal((await forgedGuess).code, "INVALID_GUESS");
    assert.equal(
      gameServer
        .getRoomSnapshot(room.roomCode)
        ?.players.find((player) => player.id === room.playerId)?.score,
      0,
    );
    assert.deepEqual(gameServer.getRoomStats(room.roomCode)?.rounds[0]?.correctGuesses, []);
  });

  it("does not restore a disconnected identity or let a fresh socket impersonate it", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host");
    const guestIdentity = await joinRoom(guest, room.roomCode, "Guest");

    const afterDisconnect = event<RoomSnapshot>(guest, "room:state");
    host.disconnect();
    const state = await afterDisconnect;
    assert.equal(state.hostId, guestIdentity.playerId);
    assert.equal(
      state.players.some((player) => player.id === room.playerId),
      false,
    );

    const replacement = await newClient();
    const forgedIdentity = event<{ code: string }>(replacement, "error");
    emitRaw(replacement, "room:join", {
      roomCode: room.roomCode,
      displayName: "Host",
      avatarId: "😎",
      playerId: room.playerId,
    });
    assert.equal((await forgedIdentity).code, "INVALID_PAYLOAD");

    const unauthorizedAction = event<{ code: string }>(replacement, "error");
    replacement.emit("game:start");
    assert.equal((await unauthorizedAction).code, "NOT_IN_ROOM");
    host.emit("game:start");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.hostId, guestIdentity.playerId);
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.players.length, 1);
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.state, GameState.Lobby);
  });

  it("expires server timers, advances rounds, and calculates final results from game statistics", async () => {
    const host = await newClient();
    const second = await newClient();
    const third = await newClient();
    const room = await createRoom(host, "Host");
    const joinedSecond = await joinRoom(second, room.roomCode, "Second");
    const joinedThird = await joinRoom(third, room.roomCode, "Third");

    const endedRounds: number[] = [];
    (host as unknown as LooseSocket).on("round:ended", (payload) => {
      endedRounds.push((payload as { roundNumber: number }).roundNumber);
    });
    const configured = event<RoomSnapshot>(host, "room:state");
    host.emit("settings:change", { settings: { rounds: 5 } });
    await configured;
    const startWordOptions = event<{ options: string[] }>(host, "word:selection");
    host.emit("game:start");
    let prefetchedOptions = await startWordOptions;
    const players = [
      { client: host, id: room.playerId },
      { client: second, id: joinedSecond.playerId },
      { client: third, id: joinedThird.playerId },
    ];

    for (let round = 1; round <= 5; round += 1) {
      const drawerId = gameServer.getRoomSnapshot(room.roomCode)?.game?.drawerId;
      const drawer = players.find((player) => player.id === drawerId)?.client ?? host;
      const firstStart = event<{ roundNumber: number; secretWord?: string }>(
        drawer,
        "round:started",
      );
      const guesserStart =
        drawer === second ? undefined : event<{ secretWord?: string }>(second, "round:started");
      const nextRoundEnded = event<{ roundNumber: number }>(host, "round:ended");
      drawer.emit("word:select", { optionIndex: 0 });
      const roundEvent = await firstStart;
      assert.equal(roundEvent.roundNumber, round);
      assert.equal(roundEvent.secretWord, prefetchedOptions.options[0]);
      if (guesserStart) assert.equal((await guesserStart).secretWord, undefined);

      if ([1, 3, 4].includes(round)) {
        const correctResult = event<{ correct: boolean; pointsAwarded: number }>(
          host,
          "guess:result",
        );
        second.emit("guess:submit", { guess: roundEvent.secretWord ?? "" });
        const result = await correctResult;
        assert.equal(result.correct, true);
        assert.ok(result.pointsAwarded > 0);
        const reaction = event<{ playerId: string }>(host, "reaction:received");
        second.emit("reaction:send", { reaction: "🔥" });
        assert.equal((await reaction).playerId, joinedSecond.playerId);
      }
      assert.equal((await nextRoundEnded).roundNumber, round);
      if (round < 5) {
        const nextDrawer = players[round % players.length]?.client ?? host;
        const nextWordOptions = event<{ options: string[] }>(nextDrawer, "word:selection");
        const state = event<RoomSnapshot>(host, "room:state");
        host.emit("game:next");
        await state;
        prefetchedOptions = await nextWordOptions;
      }
    }

    const finalResults = event<{
      rankings: Array<{ playerId: string; score: number }>;
      awards: {
        bestArtist: unknown;
        fastestGuesser: unknown;
        crowdFavorite: unknown;
        streakMaster: unknown;
      };
    }>(host, "game:ended");
    host.emit("game:next");
    const final = await finalResults;
    assert.equal(endedRounds.length, 5);
    assert.equal(gameServer.getRoomStats(room.roomCode)?.rounds.length, 5);
    assert.equal(final.rankings.length, 3);
    assert.equal(
      final.awards.bestArtist && (final.awards.bestArtist as { playerId: string }).playerId,
      room.playerId,
    );
    assert.equal(
      final.awards.fastestGuesser && (final.awards.fastestGuesser as { playerId: string }).playerId,
      joinedSecond.playerId,
    );
    assert.equal(
      final.awards.crowdFavorite && (final.awards.crowdFavorite as { playerId: string }).playerId,
      room.playerId,
    );
    assert.equal(
      final.awards.streakMaster && (final.awards.streakMaster as { playerId: string }).playerId,
      joinedSecond.playerId,
    );
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.state, "GAME_RESULTS");
  });

  it("rejects malformed payloads, applies chat rate limits, and transfers host on disconnect", async () => {
    const host = await newClient();
    const guest = await newClient();
    const invalidProfile = event<{ code: string }>(host, "error");
    host.emit("room:create", { displayName: " ", avatarId: "<script>" });
    assert.equal((await invalidProfile).code, "INVALID_PROFILE");
    const longProfile = event<{ code: string }>(host, "error");
    host.emit("room:create", { displayName: "N".repeat(21), avatarId: "😎" });
    assert.equal((await longProfile).code, "INVALID_PROFILE");
    const room = await createRoom(host, "Host");
    await joinRoom(guest, room.roomCode, "Guest");

    const oversizedChat = event<{ code: string }>(host, "error");
    host.emit("chat:send", { text: "x".repeat(141) });
    assert.equal((await oversizedChat).code, "INVALID_CHAT");

    for (let index = 0; index < 5; index += 1) {
      const message = event<{ text: string }>(guest, "chat:message");
      const text = index === 0 ? "<script>alert(1)</script>" : `hello ${index}`;
      guest.emit("chat:send", { text });
      assert.equal((await message).text, text);
    }
    const limited = event<{ code: string }>(guest, "error");
    guest.emit("chat:send", { text: "too fast" });
    assert.equal((await limited).code, "RATE_LIMITED");

    const hostAfterDisconnect = event<RoomSnapshot>(guest, "room:state");
    host.disconnect();
    const state = await hostAfterDisconnect;
    assert.equal(state.hostId, state.players[0]?.id);
    assert.equal(state.players.length, 1);
    assert.equal(state.players[0]?.displayName, "Guest");
  });

  it("rate-limits room-code guesses across one connection", async () => {
    const guesser = await newClient();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const unavailable = event<{ code: string }>(guesser, "error");
      guesser.emit("room:join", {
        roomCode: "AAAAAAAA",
        displayName: "Guesser",
        avatarId: "🐼",
      });
      assert.equal((await unavailable).code, "ROOM_UNAVAILABLE");
    }
    const limited = event<{ code: string }>(guesser, "error");
    guesser.emit("room:join", {
      roomCode: "AAAAAAAA",
      displayName: "Guesser",
      avatarId: "🐼",
    });
    assert.equal((await limited).code, "RATE_LIMITED");
  });

  it("shares room-join attempt limits across sockets from the same peer address", async () => {
    for (let connection = 0; connection < 10; connection += 1) {
      const client = await newClient();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const unavailable = event<{ code: string }>(client, "error");
        client.emit("room:join", {
          roomCode: "AAAAAAAA",
          displayName: "Guesser",
          avatarId: "🐼",
        });
        assert.equal((await unavailable).code, "ROOM_UNAVAILABLE");
      }
    }

    const nextClient = await newClient();
    const limited = event<{ code: string }>(nextClient, "error");
    nextClient.emit("room:join", {
      roomCode: "AAAAAAAA",
      displayName: "Guesser",
      avatarId: "🐼",
    });
    assert.equal((await limited).code, "RATE_LIMITED");
  });

  it("bounds simultaneous connections and room allocation", async () => {
    for (const client of clients) client.disconnect();
    clients = [];
    await gameServer.close();

    httpServer = createServer();
    gameServer = createGameServer(httpServer, {
      allowedOrigins: ["http://localhost"],
      maxConnections: 2,
      maxRooms: 1,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind to a port.");
    url = `http://127.0.0.1:${address.port}`;

    const host = await newClient();
    const second = await newClient();
    const room = await createRoom(host, "Host");
    const fullError = event<{ code: string }>(second, "error");
    second.emit("room:create", { displayName: "Second", avatarId: "🐼" });
    assert.equal((await fullError).code, "ROOM_CAPACITY");

    const rejected: TestSocket = connectSocket(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Origin: "http://localhost" },
    });
    clients.push(rejected);
    const connectionError = event<Error>(rejected, "connect_error");
    rejected.connect();
    await connectionError;
    assert.equal(rejected.connected, false);
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.players.length, 1);
  });

  it("rejects browser origins that are not explicitly allowed", async () => {
    const client: TestSocket = connectSocket(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Origin: "https://unlisted.example" },
    });
    clients.push(client);
    const denied = event<Error>(client, "connect_error");
    client.connect();
    const error = await denied;
    assert.equal(client.connected, false);
    assert.ok(error.message.length > 0);
  });
});

async function newClient(): Promise<TestSocket> {
  const client: TestSocket = connectSocket(url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: { Origin: "http://localhost" },
  });
  clients.push(client);
  const connected = event<void>(client, "connect");
  client.connect();
  await connected;
  return client;
}

async function createRoom(
  client: TestSocket,
  displayName: string,
): Promise<{ roomCode: string; playerId: string }> {
  const created = event<{ roomCode: string; playerId: string }>(client, "room:created");
  client.emit("room:create", { displayName, avatarId: "😎" });
  return created;
}

async function joinRoom(
  client: TestSocket,
  roomCode: string,
  displayName: string,
): Promise<{ playerId: string }> {
  const joined = event<{ playerId: string }>(client, "room:joined");
  client.emit("room:join", { roomCode, displayName, avatarId: "🐼" });
  return joined;
}

function emitRaw(socket: TestSocket, eventName: string, payload: unknown): void {
  (socket as unknown as LooseSocket).emit(eventName, payload);
}

function event<T>(socket: TestSocket, eventName: string, timeoutMs = 3_000): Promise<T> {
  const loose = socket as unknown as LooseSocket;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      loose.off(eventName, listener);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const listener = (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as T);
    };
    loose.once(eventName, listener);
  });
}
