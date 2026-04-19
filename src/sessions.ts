import type { MatchRecord, PreparedSession, SelectionMode } from './types.js';
import { MAX_ACTIVE_SESSIONS } from './types.js';
import { groupByFile } from './utils.js';

export class SessionStore {
  private readonly sessions = new Map<string, PreparedSession>();

  constructor(private readonly maxActiveSessions = MAX_ACTIVE_SESSIONS) {}

  getOrThrow(sessionId: string): PreparedSession {
    this.pruneExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown or expired replace session: ${sessionId}`);
    }
    return session;
  }

  store(session: PreparedSession): void {
    this.pruneExpired();
    while (this.sessions.size >= this.maxActiveSessions) {
      const oldest = this.sessions.keys().next().value;
      if (!oldest) {
        break;
      }
      this.sessions.delete(oldest);
    }
    this.sessions.set(session.sessionId, session);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (Date.parse(session.expiresAt) <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export function selectMatches(session: PreparedSession, selectionMode: SelectionMode, matchIds: string[]): MatchRecord[] {
  const ids = new Set(matchIds);
  if (selectionMode === 'include_ids') {
    return session.matches.filter((match) => ids.has(match.id));
  }
  if (selectionMode === 'exclude_ids') {
    return session.matches.filter((match) => !ids.has(match.id));
  }
  return [...session.matches];
}

export { groupByFile };
