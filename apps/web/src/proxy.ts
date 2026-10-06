import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function realtimeConnectSources(): string[] {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (!configuredUrl) return [];

  try {
    const url = new URL(configuredUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return [];
    }

    const secureProduction = process.env.NODE_ENV === "production";
    const webProtocol = secureProduction && url.protocol === "http:" ? "https:" : url.protocol;
    const socketProtocol = webProtocol === "https:" ? "wss:" : "ws:";
    return [...new Set([`${webProtocol}//${url.host}`, `${socketProtocol}//${url.host}`])];
  } catch {
    return [];
  }
}

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Overwrite caller input so it cannot choose the nonce trusted by Next's rendered scripts.
  const nonce = randomBytes(16).toString("base64");
  const connectSources = ["'self'", ...realtimeConnectSources()].join(" ");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // The drawing palette uses fixed, non-user-controlled inline color style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
