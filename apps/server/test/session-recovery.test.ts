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

describe("guest session recovery and room lifecycle", () => {
  beforeEach(async () => {
    httpServer = createServer();
    gameServer = createGameServer(httpServer, {
      allowedOrigins: ["http://localhost"],
      roundDurationOverrideMs: 1_000,
      wordSelectionDurationMs: 2_000,
      reconnectGraceMs: 200,
      sessionTtlMs: 5_000,
      roomInactivityTtlMs: 5_000,
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

  it("reconnect restores same player identity with valid session token", async () => {
    const host = await newClient();
    const created = await createRoom(host, "Host Player");
    assert.ok(created.sessionToken);

    // Host disconnects
    host.disconnect();

    // Reconnecting with a new socket and the session token restores identity
    const reconnectSocket = await newClient();
    const restoredPromise = event<{ roomCode: string; playerId: string; sessionToken: string }>(
      reconnectSocket,
      "session:restored",
    );
    const roomStatePromise = event<RoomSnapshot>(reconnectSocket, "room:state");

    reconnectSocket.emit("session:reconnect", {
      roomCode: created.roomCode,
      sessionToken: created.sessionToken,
    });

    const restored = await restoredPromise;
    assert.equal(restored.playerId, created.playerId);
    assert.equal(restored.roomCode, created.roomCode);
    assert.equal(restored.sessionToken, created.sessionToken);

    const snapshot = await roomStatePromise;
    assert.equal(snapshot.hostId, created.playerId);
    assert.equal(snapshot.players.length, 1);
    assert.equal(snapshot.players[0]?.id, created.playerId);
    assert.equal(snapshot.players[0]?.connected, true);
  });

  it("rejects forged session tokens safely without revealing session presence", async () => {
    const host = await newClient();
    const created = await createRoom(host, "Host Player");

    const attacker = await newClient();
    const errorPromise = event<{ code: string }>(attacker, "error");

    attacker.emit("session:reconnect", {
      roomCode: created.roomCode,
      sessionToken: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });

    const error = await errorPromise;
    assert.equal(error.code, "INVALID_SESSION");
  });

  it("rejects expired sessions and cleans up storage", async () => {
    // Create short TTL server
    const localHttp = createServer();
    const shortTtlServer = createGameServer(localHttp, {
      allowedOrigins: ["http://localhost"],
      sessionTtlMs: 50,
      reconnectGraceMs: 500,
    });
    await new Promise<void>((resolve) => localHttp.listen(0, "127.0.0.1", resolve));
    const addr = localHttp.address();
    const shortUrl = `http://127.0.0.1:${(addr as { port: number }).port}`;

    const host = connectSocket(shortUrl, {
      transports: ["websocket"],
      extraHeaders: { origin: "http://localhost" },
    }) as TestSocket;
    clients.push(host);
    await new Promise<void>((resolve) => host.once("connect", () => resolve()));

    const created = await createRoom(host, "Host Player");

    // Wait past session TTL
    await new Promise<void>((resolve) => setTimeout(resolve, 80));

    host.disconnect();

    const reconnectClient = connectSocket(shortUrl, {
      transports: ["websocket"],
      extraHeaders: { origin: "http://localhost" },
    }) as TestSocket;
    clients.push(reconnectClient);
    await new Promise<void>((resolve) => reconnectClient.once("connect", () => resolve()));

    const errorPromise = event<{ code: string }>(reconnectClient, "error");
    reconnectClient.emit("session:reconnect", {
      roomCode: created.roomCode,
      sessionToken: created.sessionToken,
    });

    const error = await errorPromise;
    assert.equal(error.code, "INVALID_SESSION");

    await shortTtlServer.close();
    localHttp.close();
  });

  it("prevents using session from Room A to access Room B", async () => {
    const hostA = await newClient();
    const hostB = await newClient();
    const roomA = await createRoom(hostA, "Host A");
    const roomB = await createRoom(hostB, "Host B");

    const rogue = await newClient();
    const errorPromise = event<{ code: string }>(rogue, "error");

    // Try to reconnect to Room B using Room A's valid session token
    rogue.emit("session:reconnect", {
      roomCode: roomB.roomCode,
      sessionToken: roomA.sessionToken,
    });

    const error = await errorPromise;
    assert.equal(error.code, "INVALID_SESSION");
  });

  it("terminates old socket authorization when duplicate connection takes over session", async () => {
    const host = await newClient();
    const room = await createRoom(host, "Host Player");

    const oldSocketError = event<{ code: string }>(host, "error");

    // Second connection presents same valid session
    const takeover = await newClient();
    const restored = event<{ playerId: string }>(takeover, "session:restored");
    takeover.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: room.sessionToken,
    });

    await restored;
    const replaced = await oldSocketError;
    assert.equal(replaced.code, "SESSION_REPLACED");

    // Old socket can no longer emit room actions
    const unauthorized = event<{ code: string }>(host, "error");
    host.emit("chat:send", { text: "old socket talking" });
    assert.equal((await unauthorized).code, "NOT_IN_ROOM");

    // Takeover socket can emit room actions
    const chatReceived = event<RoomSnapshot>(takeover, "room:state");
    takeover.emit("chat:send", { text: "new socket active" });
    assert.equal((await chatReceived).chat.at(-1)?.text, "new socket active");
  });

  it("restores lobby state and settings to reconnected player", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host Player");
    const guestSession = await joinRoom(guest, room.roomCode, "Guest Player");

    // Host updates settings
    const settingsUpdate = event<RoomSnapshot>(host, "room:state");
    host.emit("settings:change", { settings: { rounds: 5 } });
    await settingsUpdate;

    // Guest disconnects
    guest.disconnect();

    // Guest reconnects
    const guestReconnect = await newClient();
    const statePromise = event<RoomSnapshot>(guestReconnect, "room:state");
    guestReconnect.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: guestSession.sessionToken,
    });

    const state = await statePromise;
    assert.equal(state.settings.rounds, 5);
    assert.equal(state.players.length, 2);
    assert.equal(state.players.find((p) => p.id === guestSession.playerId)?.connected, true);
  });

  it("drawer reconnect receives secret word, but guesser reconnect NEVER receives secret word", async () => {
    const host = await newClient();
    const guesser = await newClient();
    const room = await createRoom(host, "Host/Drawer");
    const guesserSession = await joinRoom(guesser, room.roomCode, "Guesser");

    const wordOptionsPromise = event<{ options: string[] }>(host, "word:selection");
    host.emit("game:start");
    const wordOptions = await wordOptionsPromise;
    const chosenWord = wordOptions.options[0]!;

    const roundStarted = event<{ secretWord?: string }>(host, "round:started");
    host.emit("word:select", { optionIndex: 0 });
    const started = await roundStarted;
    assert.equal(started.secretWord, chosenWord);

    // 1. Drawer disconnects and reconnects
    host.disconnect();
    const drawerReconnect = await newClient();
    const drawerRoundRestored = event<{ secretWord?: string }>(drawerReconnect, "round:started");
    drawerReconnect.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: room.sessionToken,
    });
    const drawerRestored = await drawerRoundRestored;
    assert.equal(drawerRestored.secretWord, chosenWord);

    // 2. Guesser disconnects and reconnects
    guesser.disconnect();
    const guesserReconnect = await newClient();
    let secretLeakedToGuesser = false;
    (guesserReconnect as unknown as LooseSocket).onAny((event, payload) => {
      if (payload && typeof payload === "object" && "secretWord" in payload) {
        secretLeakedToGuesser = true;
      }
    });

    const guesserStatePromise = event<RoomSnapshot>(guesserReconnect, "room:state");
    guesserReconnect.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: guesserSession.sessionToken,
    });

    const guesserState = await guesserStatePromise;
    assert.equal(guesserState.game?.phase, GameState.Drawing);
    assert.equal(secretLeakedToGuesser, false);
    // Masked word is masked (contains only revealed letters or empty strings)
    assert.ok(guesserState.game?.maskedWord);
    assert.notEqual(guesserState.game?.maskedWord.join(""), chosenWord);
  });

  it("host disconnect retains host during grace period and transfers after grace expiry", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host Player");
    const guestSession = await joinRoom(guest, room.roomCode, "Guest Player");

    // Host disconnects
    const stateDuringGrace = event<RoomSnapshot>(guest, "room:state");
    host.disconnect();

    const duringGrace = await stateDuringGrace;
    // Host is still host during grace period
    assert.equal(duringGrace.hostId, room.playerId);
    assert.equal(duringGrace.players.find((p) => p.id === room.playerId)?.connected, false);

    // Wait for grace period to expire (grace is 200ms)
    const afterGraceExpiry = event<RoomSnapshot>(guest, "room:state");
    const expiredState = await afterGraceExpiry;
    assert.equal(expiredState.hostId, guestSession.playerId);
    assert.equal(
      expiredState.players.some((p) => p.id === room.playerId),
      false,
    );
  });

  it("drawer disconnect expires grace and advances/finishes round without stalling", async () => {
    const host = await newClient();
    const guesser = await newClient();
    const room = await createRoom(host, "Host/Drawer");
    await joinRoom(guesser, room.roomCode, "Guesser");

    const wordOptionsPromise = event<{ options: string[] }>(host, "word:selection");
    host.emit("game:start");
    await wordOptionsPromise;

    const roundStartedPromise = event<unknown>(guesser, "round:started");
    host.emit("word:select", { optionIndex: 0 });
    await roundStartedPromise;

    const roundEndedPromise = event<{ answer: string }>(guesser, "round:ended");

    // Drawer disconnects during drawing
    host.disconnect();

    // Round should automatically finish when grace timer (200ms) expires
    const ended = await roundEndedPromise;
    assert.ok(ended.answer);
    assert.equal(gameServer.getRoomSnapshot(room.roomCode)?.state, GameState.RoundResults);
  });

  it("cleans up empty rooms and associated sessions after grace expiry", async () => {
    const host = await newClient();
    const room = await createRoom(host, "Host Player");

    assert.equal(gameServer.getSessionCount(), 1);
    assert.ok(gameServer.getRoomSnapshot(room.roomCode));

    // Host disconnects
    host.disconnect();

    // Wait for grace period (200ms) to expire
    await new Promise<void>((resolve) => setTimeout(resolve, 260));

    // Room and session are cleaned up
    assert.equal(gameServer.getRoomSnapshot(room.roomCode), undefined);
    assert.equal(gameServer.getSessionCount(), 0);
  });

  it("host reconnecting within grace period retains host authority and starts game", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host");
    await joinRoom(guest, room.roomCode, "Guest");

    // Host disconnects briefly (within grace period)
    host.disconnect();

    const hostReconnect = await newClient();
    const restored = event<{ playerId: string }>(hostReconnect, "session:restored");
    hostReconnect.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: room.sessionToken,
    });
    await restored;

    // Verify host is still host and can start the game
    const gameStarted = event<{ totalRounds: number }>(guest, "game:started");
    hostReconnect.emit("game:start");
    assert.equal((await gameStarted).totalRounds, 3);
  });

  it("reconnecting player cannot bypass role authorization", async () => {
    const host = await newClient();
    const guest = await newClient();
    const room = await createRoom(host, "Host");
    const guestSession = await joinRoom(guest, room.roomCode, "Guest");

    guest.disconnect();
    const guestReconnect = await newClient();
    const restoredPromise = event<{ playerId: string }>(guestReconnect, "session:restored");
    guestReconnect.emit("session:reconnect", {
      roomCode: room.roomCode,
      sessionToken: guestSession.sessionToken,
    });
    await restoredPromise;

    // Reconnected guest cannot start the game (host only)
    const hostOnlyError = event<{ code: string }>(guestReconnect, "error");
    guestReconnect.emit("game:start");
    assert.equal((await hostOnlyError).code, "HOST_ONLY");
  });

  it("cross-room isolation remains strictly enforced after session recovery", async () => {
    const hostA = await newClient();
    const hostB = await newClient();
    const roomA = await createRoom(hostA, "Host A");
    const roomB = await createRoom(hostB, "Host B");

    // Host A reconnects
    hostA.disconnect();
    const hostAReconnect = await newClient();
    const restoredPromise = event<{ playerId: string }>(hostAReconnect, "session:restored");
    hostAReconnect.emit("session:reconnect", {
      roomCode: roomA.roomCode,
      sessionToken: roomA.sessionToken,
    });
    await restoredPromise;

    // Chat in Room A is not seen by Room B
    let roomBReceived = false;
    (hostB as unknown as LooseSocket).on("chat:message", () => {
      roomBReceived = true;
    });

    const chatUpdate = event<RoomSnapshot>(hostAReconnect, "room:state");
    hostAReconnect.emit("chat:send", { text: "Secret to Room A" });
    await chatUpdate;

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(roomBReceived, false);
    assert.equal(gameServer.getRoomSnapshot(roomB.roomCode)?.chat.length, 0);
  });

  it("rate limits rapid reconnect attempts per socket", async () => {
    const socket = await newClient();
    const errors: Array<{ code: string }> = [];
    (socket as unknown as LooseSocket).on("error", (err: unknown) => {
      if (err && typeof err === "object" && "code" in err) {
        errors.push(err as { code: string });
      }
    });

    for (let index = 0; index < 15; index += 1) {
      socket.emit("session:reconnect", {
        roomCode: "ABCDEF23",
        sessionToken: "invalid-token",
      });
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.ok(errors.some((err) => err.code === "RATE_LIMITED"));
  });

  async function newClient(): Promise<TestSocket> {
    const client = connectSocket(url, {
      transports: ["websocket"],
      extraHeaders: { origin: "http://localhost" },
    }) as TestSocket;
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("connect_error", (error) => reject(error));
    });
    return client;
  }

  function event<T>(socket: TestSocket, eventName: string, timeoutMs = 2_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for event "${eventName}"`)),
        timeoutMs,
      );
      (socket as unknown as LooseSocket).once(eventName, (payload: unknown) => {
        clearTimeout(timer);
        resolve(payload as T);
      });
    });
  }

  async function createRoom(
    socket: TestSocket,
    displayName: string,
    avatarId = "😎",
  ): Promise<{ roomCode: string; playerId: string; sessionToken: string }> {
    const promise = event<{ roomCode: string; playerId: string; sessionToken: string }>(
      socket,
      "room:created",
    );
    socket.emit("room:create", { displayName, avatarId });
    return promise;
  }

  async function joinRoom(
    socket: TestSocket,
    roomCode: string,
    displayName: string,
    avatarId = "🤖",
  ): Promise<{ roomCode: string; playerId: string; sessionToken: string }> {
    const promise = event<{ roomCode: string; playerId: string; sessionToken: string }>(
      socket,
      "room:joined",
    );
    socket.emit("room:join", { roomCode, displayName, avatarId });
    return promise;
  }
});
