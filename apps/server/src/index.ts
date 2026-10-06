import { createServer } from "node:http";

import { loadRealtimeServerConfig } from "./config.js";
import { createGameServer } from "./game-server.js";

const config = loadRealtimeServerConfig(process.env);

const httpServer = createServer();
const gameServer = createGameServer(httpServer, {
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
});

let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down DoodleRush server gracefully...`);

  try {
    await gameServer.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("DoodleRush server stopped cleanly.");
    process.exit(0);
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception in DoodleRush server:", error);
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in DoodleRush server:", reason);
  void shutdown("unhandledRejection");
});

httpServer.listen(config.port, () => {
  console.log(`DoodleRush realtime server listening on port ${config.port}`);
});
