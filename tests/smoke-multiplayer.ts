import assert from "node:assert/strict";
import { createServer } from "node:http";
import { io as connectSocket, type Socket as ClientSocket } from "socket.io-client";

// Import compiled production server
import { createGameServer } from "../apps/server/dist/game-server.js";
import {
  GameState,
  type ClientToServerEvents,
  type RoomSnapshot,
  type ServerToClientEvents,
} from "../packages/shared/dist/index.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function event<T>(socket: TestSocket, eventName: string, timeoutMs = 4_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for event "${eventName}"`)),
      timeoutMs,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (socket as any).once(eventName, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

async function runMultiplayerSmokeTest(): Promise<void> {
  console.log("Starting DoodleRush Phase 4 Production Multiplayer Smoke Test...");

  const httpServer = createServer();
  const gameServer = createGameServer(httpServer, {
    allowedOrigins: ["http://localhost:3000"],
    roundDurationOverrideMs: 2_000,
    wordSelectionDurationMs: 2_000,
    reconnectGraceMs: 1_000,
    sessionTtlMs: 30_000,
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Could not bind test server.");
  const serverUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Compiled production server listening at ${serverUrl}`);

  const activeClients: TestSocket[] = [];

  function makeClient(): Promise<TestSocket> {
    const client = connectSocket(serverUrl, {
      transports: ["websocket"],
      extraHeaders: { origin: "http://localhost:3000" },
    }) as TestSocket;
    activeClients.push(client);
    return new Promise<TestSocket>((resolve, reject) => {
      client.once("connect", () => resolve(client));
      client.once("connect_error", (err) => reject(err));
    });
  }

  try {
    // 1. Client 1 creates room
    console.log("Step 1: Client 1 creates room...");
    const client1 = await makeClient();
    const roomCreatedPromise = event<{ roomCode: string; playerId: string; sessionToken: string }>(
      client1,
      "room:created",
    );
    client1.emit("room:create", { displayName: "Alice (Host)", avatarId: "😎" });
    const { roomCode, playerId: player1Id, sessionToken: sessionToken1 } = await roomCreatedPromise;
    assert.match(roomCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(sessionToken1);
    console.log(`  Room created: ${roomCode}, Host ID: ${player1Id}`);

    // 2. Client 2 joins room
    console.log("Step 2: Client 2 joins room...");
    const client2 = await makeClient();
    const roomJoinedPromise = event<{ roomCode: string; playerId: string; sessionToken: string }>(
      client2,
      "room:joined",
    );
    client2.emit("room:join", { roomCode, displayName: "Bob (Guesser)", avatarId: "🤖" });
    const { playerId: player2Id, sessionToken: sessionToken2 } = await roomJoinedPromise;
    assert.ok(sessionToken2);
    assert.notEqual(player1Id, player2Id);
    console.log(`  Client 2 joined, ID: ${player2Id}`);

    // 3. Start game
    console.log("Step 3: Start game...");
    const wordOptionsPromise = event<{ options: string[] }>(client1, "word:selection");
    client1.emit("game:start");
    const { options } = await wordOptionsPromise;
    assert.ok(options.length > 0);
    const selectedWord = options[0]!;
    console.log(`  Word selection active. Host chose word: ${selectedWord}`);

    const roundStartedDrawer = event<{ secretWord?: string }>(client1, "round:started");
    const roundStartedGuesser = event<{ secretWord?: string }>(client2, "round:started");
    client1.emit("word:select", { optionIndex: 0 });

    const [drawerPayload, guesserPayload] = await Promise.all([
      roundStartedDrawer,
      roundStartedGuesser,
    ]);
    assert.equal(drawerPayload.secretWord, selectedWord);
    assert.equal(guesserPayload.secretWord, undefined); // Guesser NEVER gets secretWord!
    console.log("  Round started: Secret word isolated strictly to drawer.");

    // Drawer draws a stroke
    const drawingPromise = event<unknown>(client2, "drawing:updated");
    client1.emit("drawing:update", {
      type: "add",
      stroke: {
        id: "stroke-1",
        color: "#263b5b",
        size: 5,
        tool: "pen",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.5 },
        ],
      },
    });
    await drawingPromise;
    console.log("  Drawing stroke synchronized from Drawer to Guesser.");

    // Bob submits guess
    const guessResult = event<{ correct: boolean; pointsAwarded: number; score: number }>(
      client2,
      "guess:result",
    );
    client2.emit("guess:submit", { guess: selectedWord });
    const bobGuess = await guessResult;
    assert.equal(bobGuess.correct, true);
    assert.ok(bobGuess.pointsAwarded > 0);
    console.log(`  Guesser correctly guessed "${selectedWord}" and scored ${bobGuess.score} pts.`);

    // 4. Disconnect Client 2
    console.log("Step 4: Disconnect Client 2 during active game...");
    const hostSeesDisconnect = event<RoomSnapshot>(client1, "room:state");
    client2.disconnect();
    const hostSnapshot = await hostSeesDisconnect;
    const bobStatus = hostSnapshot.players.find((p) => p.id === player2Id);
    assert.ok(bobStatus);
    assert.equal(bobStatus.connected, false);
    console.log("  Host received updated state: Bob is marked disconnected (in grace period).");

    // 5 & 6. Reconnect Client 2 within grace period
    console.log("Steps 5 & 6: Reconnect Client 2 with session token...");
    const client2Reconnect = await makeClient();
    const bobRestoredPromise = event<{ roomCode: string; playerId: string }>(
      client2Reconnect,
      "session:restored",
    );
    const bobStatePromise = event<RoomSnapshot>(client2Reconnect, "room:state");

    client2Reconnect.emit("session:reconnect", {
      roomCode,
      sessionToken: sessionToken2,
    });

    const bobRestored = await bobRestoredPromise;
    assert.equal(bobRestored.playerId, player2Id); // Same identity restored!
    console.log("  Bob successfully restored with identical Player ID!");

    // 7. Room and game state synchronized
    console.log("Step 7: Verify synchronized room/game state...");
    const bobSnapshot = await bobStatePromise;
    assert.equal(bobSnapshot.players.length, 2);
    const restoredBob = bobSnapshot.players.find((p) => p.id === player2Id);
    assert.ok(restoredBob);
    assert.equal(restoredBob.connected, true);
    console.log("  Synchronized room state verified.");

    // 8. Drawer/guesser visibility remains correct
    console.log("Step 8: Verify drawer/guesser visibility after reconnect...");
    // Public game snapshot contains only masked word
    assert.ok(bobSnapshot.game?.maskedWord);
    assert.notEqual(bobSnapshot.game?.maskedWord.join(""), selectedWord);
    console.log("  Guesser visibility verified: Secret word remains protected.");

    // 9. Scores remain correct
    console.log("Step 9: Verify scores remain intact after reconnect...");
    assert.equal(restoredBob.score, bobGuess.score);
    console.log(`  Bob score verified intact: ${restoredBob.score} pts.`);

    // Advance game to finish
    console.log("Step 10: Advance to game results and verify final synchronized awards...");
    // Alice advances round 1 -> round 2 (Bob is drawer)
    const round2WordOptions = event<{ options: string[] }>(client2Reconnect, "word:selection");
    client1.emit("game:next");
    const r2Options = await round2WordOptions;
    console.log("  Round 2 active. Reconnected Bob is drawer, received word options.");
    const round2Started = event<{ secretWord?: string }>(client2Reconnect, "round:started");
    client2Reconnect.emit("word:select", { optionIndex: 0 });
    await round2Started;

    // Alice guesses Bob's drawing in round 2
    const aliceGuessResult = event<{ correct: boolean }>(client1, "guess:result");
    client1.emit("guess:submit", { guess: r2Options.options[0]! });
    await aliceGuessResult;
    console.log("  Round 2 completed after Host solved Bob's drawing.");

    // Alice advances to round 3 (Alice is drawer)
    const round3WordOptions = event<{ options: string[] }>(client1, "word:selection");
    client1.emit("game:next");
    const r3Options = await round3WordOptions;
    const round3Started = event<{ secretWord?: string }>(client1, "round:started");
    client1.emit("word:select", { optionIndex: 0 });
    await round3Started;

    // Bob guesses in round 3
    const bobGuess3 = event<{ correct: boolean }>(client2Reconnect, "guess:result");
    client2Reconnect.emit("guess:submit", { guess: r3Options.options[0]! });
    await bobGuess3;
    console.log("  Round 3 completed after Bob solved Alice's drawing.");

    // Final game ended
    const finalResultsDrawer = event<{ winnerId: string; rankings: unknown[]; awards: unknown[] }>(
      client1,
      "game:ended",
    );
    const finalResultsGuesser = event<{ winnerId: string; rankings: unknown[]; awards: unknown[] }>(
      client2Reconnect,
      "game:ended",
    );
    client1.emit("game:next");

    const [final1, final2] = await Promise.all([finalResultsDrawer, finalResultsGuesser]);
    assert.deepEqual(final1, final2);
    assert.equal(final1.rankings.length, 2);
    assert.ok(final1.awards && typeof final1.awards === "object");
    console.log("  Deterministic final awards and rankings synchronized to both clients!");

    console.log(
      "\nALL 10 VERIFICATION STEPS PASSED IN MULTIPLAYER SMOKE TEST WITH COMPILED SERVER!",
    );
  } finally {
    for (const c of activeClients) c.disconnect();
    await gameServer.close();
    httpServer.close();
  }
}

runMultiplayerSmokeTest().catch((err) => {
  console.error("Multiplayer smoke test failed:", err);
  process.exit(1);
});
