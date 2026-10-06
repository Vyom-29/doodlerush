export interface RealtimeServerConfig {
  port: number;
  allowedOrigins: string[];
  trustProxy: boolean;
}

export function loadRealtimeServerConfig(env: NodeJS.ProcessEnv): RealtimeServerConfig {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port.");
  }

  const isProduction = env.NODE_ENV === "production";
  const configuredOrigins = env.WEB_ORIGIN?.trim();
  if (isProduction && !configuredOrigins) {
    throw new Error("WEB_ORIGIN must explicitly list the production web origin.");
  }
  const allowedOrigins = validateAllowedOrigins(
    (configuredOrigins || "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction,
  );
  const trustProxy = env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1";
  return { port, allowedOrigins, trustProxy };
}

export function validateAllowedOrigins(origins: readonly string[], production = false): string[] {
  if (!origins.length) throw new Error("At least one explicit web origin is required.");

  const normalized = origins.map((origin) => {
    if (origin === "*") throw new Error("Wildcard origins are not allowed.");
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("WEB_ORIGIN must contain valid absolute origins.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== origin
    ) {
      throw new Error(
        "WEB_ORIGIN entries must be exact http(s) origins without paths or credentials.",
      );
    }
    if (production && url.protocol !== "https:") {
      throw new Error("Production WEB_ORIGIN entries must use HTTPS.");
    }
    return url.origin;
  });

  return [...new Set(normalized)];
}
