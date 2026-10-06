import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GuestSessionStore } from "../src/session-store.js";

describe("GuestSessionStore", () => {
  it("creates cryptographically unpredictable session tokens and retrieves active sessions", () => {
    const mockTime = 1_000_000;
    const store = new GuestSessionStore({ now: () => mockTime });

    const sessionA = store.createSession("player-1", "ROOM1234", "Player One", "😎");
    assert.match(sessionA.token, /^[0-9a-f]{64}$/);
    assert.equal(sessionA.playerId, "player-1");
    assert.equal(sessionA.roomCode, "ROOM1234");
    assert.equal(sessionA.displayName, "Player One");
    assert.equal(sessionA.avatarId, "😎");
    assert.equal(sessionA.createdAt, 1_000_000);

    const retrieved = store.getSession(sessionA.token);
    assert.ok(retrieved);
    assert.equal(retrieved.playerId, "player-1");

    // Invalid or empty tokens fail safely without throwing
    assert.equal(store.getSession(""), undefined);
    assert.equal(store.getSession("forged-token-value"), undefined);
  });

  it("expires sessions beyond TTL and rejects retrieval", () => {
    let mockTime = 1_000_000;
    const store = new GuestSessionStore({ ttlMs: 60_000, now: () => mockTime });

    const session = store.createSession("player-1", "ROOM1234", "Player One", "😎");
    assert.ok(store.getSession(session.token));

    // Advance time past TTL
    mockTime += 60_001;
    assert.equal(store.getSession(session.token), undefined);
    assert.equal(store.size(), 0);
  });

  it("prunes expired sessions and removes sessions for deleted rooms", () => {
    let mockTime = 1_000_000;
    const store = new GuestSessionStore({ ttlMs: 50_000, now: () => mockTime });

    const session1 = store.createSession("p1", "ROOMAAAA", "P1", "😎");
    const session2 = store.createSession("p2", "ROOMBBBB", "P2", "🤖");
    assert.equal(store.size(), 2);

    store.deleteSessionsForRoom("ROOMAAAA");
    assert.equal(store.getSession(session1.token), undefined);
    assert.ok(store.getSession(session2.token));
    assert.equal(store.size(), 1);

    mockTime += 60_000;
    const pruned = store.pruneExpired(mockTime);
    assert.equal(pruned, 1);
    assert.equal(store.size(), 0);
  });

  it("enforces memory bounds by evicting oldest session when capacity is reached", () => {
    let mockTime = 1_000_000;
    const store = new GuestSessionStore({ maxSessions: 3, ttlMs: 1_000_000, now: () => mockTime });

    mockTime = 1_000_000;
    const s1 = store.createSession("p1", "R1", "P1", "😎");
    mockTime = 1_000_100;
    const s2 = store.createSession("p2", "R2", "P2", "🤖");
    mockTime = 1_000_200;
    const s3 = store.createSession("p3", "R3", "P3", "🐸");
    assert.equal(store.size(), 3);

    // Creating a 4th session should evict s1 (the oldest by lastSeenAt)
    mockTime = 1_000_300;
    const s4 = store.createSession("p4", "R4", "P4", "🐱");
    assert.equal(store.size(), 3);
    assert.equal(store.getSession(s1.token), undefined);
    assert.ok(store.getSession(s2.token));
    assert.ok(store.getSession(s3.token));
    assert.ok(store.getSession(s4.token));
  });
});
