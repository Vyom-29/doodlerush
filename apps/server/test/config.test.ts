import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRealtimeServerConfig, validateAllowedOrigins } from "../src/config.js";

describe("realtime server configuration", () => {
  it("keeps localhost as the development default and accepts explicit origin lists", () => {
    assert.deepEqual(loadRealtimeServerConfig({}), {
      port: 3001,
      allowedOrigins: ["http://localhost:3000"],
      trustProxy: false,
    });
    assert.deepEqual(
      loadRealtimeServerConfig({
        PORT: "3010",
        WEB_ORIGIN: "https://draw.example, https://play.example",
        TRUST_PROXY: "true",
      }),
      {
        port: 3010,
        allowedOrigins: ["https://draw.example", "https://play.example"],
        trustProxy: true,
      },
    );
  });

  it("requires an explicit HTTPS origin in production", () => {
    assert.throws(
      () => loadRealtimeServerConfig({ NODE_ENV: "production" }),
      /WEB_ORIGIN must explicitly list/,
    );
    assert.throws(
      () => loadRealtimeServerConfig({ NODE_ENV: "production", WEB_ORIGIN: "http://draw.example" }),
      /must use HTTPS/,
    );
    assert.deepEqual(
      loadRealtimeServerConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://draw.example" }),
      { port: 3001, allowedOrigins: ["https://draw.example"], trustProxy: false },
    );
  });

  it("rejects wildcard, path, credentials, and malformed origins", () => {
    for (const origin of [
      "*",
      "https://draw.example/path",
      "https://user:pass@draw.example",
      "not a url",
    ]) {
      assert.throws(() => validateAllowedOrigins([origin]));
    }
    assert.throws(() => validateAllowedOrigins([]));
  });

  it("rejects invalid ports", () => {
    assert.throws(() => loadRealtimeServerConfig({ PORT: "70000" }), /valid TCP port/);
  });
});
