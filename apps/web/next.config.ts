import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

function validateProductionSocketUrl(): void {
  const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  let parsedSocketUrl: URL | undefined;
  try {
    parsedSocketUrl = socketUrl ? new URL(socketUrl) : undefined;
  } catch {
    throw new Error("NEXT_PUBLIC_SOCKET_URL must be a valid HTTPS URL for production builds.");
  }
  if (
    !parsedSocketUrl ||
    parsedSocketUrl.protocol !== "https:" ||
    parsedSocketUrl.username ||
    parsedSocketUrl.password ||
    parsedSocketUrl.search ||
    parsedSocketUrl.hash
  ) {
    throw new Error("NEXT_PUBLIC_SOCKET_URL must be a valid HTTPS URL for production builds.");
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ["@doodlerush/game-engine", "@doodlerush/shared"],
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    if (process.env.NODE_ENV === "production") {
      // Apply HSTS to this host only; do not assume every sibling subdomain has TLS.
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000",
      });
    }
    return [{ source: "/:path*", headers }];
  },
  ...(process.env.DOODLERUSH_NEXT_DIST_DIR
    ? { distDir: process.env.DOODLERUSH_NEXT_DIST_DIR }
    : {}),
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) validateProductionSocketUrl();
  return nextConfig;
}
