import { randomBytes } from "node:crypto";
import type { PlayerId, RoomCode } from "@doodlerush/shared";

export interface GuestSession {
  token: string;
  playerId: PlayerId;
  roomCode: RoomCode;
  displayName: string;
  avatarId: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface SessionStoreOptions {
  ttlMs?: number;
  maxSessions?: number;
  now?: () => number;
}

export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_MAX_SESSIONS = 2_048;

export class GuestSessionStore {
  private readonly sessions = new Map<string, GuestSession>();
  private readonly ttlMs: number;
  private readonly maxSessions: number;
  private readonly now: () => number;

  constructor(options?: SessionStoreOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxSessions = options?.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.now = options?.now ?? Date.now;
  }

  createSession(
    playerId: PlayerId,
    roomCode: RoomCode,
    displayName: string,
    avatarId: string,
  ): GuestSession {
    const timestamp = this.now();
    if (this.sessions.size >= this.maxSessions) {
      this.pruneExpired(timestamp);
    }
    if (this.sessions.size >= this.maxSessions) {
      // Evict oldest session by lastSeenAt to preserve bounded memory.
      let oldestToken: string | null = null;
      let oldestTime = Number.POSITIVE_INFINITY;
      for (const [token, session] of this.sessions) {
        if (session.lastSeenAt < oldestTime) {
          oldestTime = session.lastSeenAt;
          oldestToken = token;
        }
      }
      if (oldestToken) {
        this.sessions.delete(oldestToken);
      }
    }

    const token = randomBytes(32).toString("hex");
    const session: GuestSession = {
      token,
      playerId,
      roomCode,
      displayName,
      avatarId,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    };
    this.sessions.set(token, session);
    return session;
  }

  getSession(token: string): GuestSession | undefined {
    if (typeof token !== "string" || !token) return undefined;
    const session = this.sessions.get(token);
    if (!session) return undefined;

    const timestamp = this.now();
    if (timestamp - session.createdAt > this.ttlMs) {
      this.sessions.delete(token);
      return undefined;
    }

    session.lastSeenAt = timestamp;
    return session;
  }

  touchSession(token: string): void {
    const session = this.sessions.get(token);
    if (session) {
      session.lastSeenAt = this.now();
    }
  }

  deleteSession(token: string): void {
    this.sessions.delete(token);
  }

  deleteSessionsForRoom(roomCode: RoomCode): void {
    for (const [token, session] of this.sessions) {
      if (session.roomCode === roomCode) {
        this.sessions.delete(token);
      }
    }
  }

  pruneExpired(currentTimestamp = this.now()): number {
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (currentTimestamp - session.createdAt > this.ttlMs) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }
}
