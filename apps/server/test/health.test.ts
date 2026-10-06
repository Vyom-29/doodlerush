import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createGameServer, type GameServer } from "../src/game-server.js";

let httpServer: HttpServer;
let gameServer: GameServer;
let baseUrl: string;

describe("server health endpoints", () => {
  beforeEach(async () => {
    httpServer = createServer();
    gameServer = createGameServer(httpServer, {
      allowedOrigins: ["http://localhost"],
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server failed to bind to a port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await gameServer.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("responds with status ok on GET /health", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, { status: "ok" });
    assert.equal(Object.keys(body).length, 1);
  });

  it("responds with status ok on GET /healthz", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, { status: "ok" });
  });

  it("responds with 200 OK and no body on HEAD /health", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    const text = await res.text();
    assert.equal(text, "");
  });

  it("rejects non-GET/HEAD methods with 405 Method Not Allowed", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    assert.equal(res.status, 405);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "Method Not Allowed");
  });

  it("returns 404 Not Found on unknown paths", async () => {
    const res = await fetch(`${baseUrl}/random-unknown-endpoint`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, "Not Found");
  });
});
