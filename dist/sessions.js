import { MAX_ACTIVE_SESSIONS } from './types.js';
import { groupByFile } from './utils.js';
export class SessionStore {
    maxActiveSessions;
    sessions = new Map();
    constructor(maxActiveSessions = MAX_ACTIVE_SESSIONS) {
        this.maxActiveSessions = maxActiveSessions;
    }
    getOrThrow(sessionId) {
        this.pruneExpired();
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Unknown or expired replace session: ${sessionId}`);
        }
        return session;
    }
    store(session) {
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
    delete(sessionId) {
        this.sessions.delete(sessionId);
    }
    pruneExpired() {
        const now = Date.now();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (Date.parse(session.expiresAt) <= now) {
                this.sessions.delete(sessionId);
            }
        }
    }
}
export function selectMatches(session, selectionMode, matchIds) {
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
