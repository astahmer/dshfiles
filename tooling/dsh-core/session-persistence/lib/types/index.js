/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately; callers address one stored
 * session through a {@link SessionHandle} obtained from `create`/`open`.
 * @module @deepseek-ai/dsh-session-persistence
 */
import { Service } from '@deepseek-ai/cordis';
export { SessionPersistenceRevision } from './revision.js';
export { SessionAlreadyExistsError, SessionAlreadyOwnedError, SessionFormatUnsupportedError, SessionHandleClosedError, SessionOwnershipLostError, SessionPersistenceCorruptionError, SessionPersistenceNotFoundError, SessionReadOnlyError, sessionFormatVersionRefusal, } from './errors.js';
export { assertNoRetiredStoredEvent, assertContiguous, assertStoredId, assertVersion, decodeStoredEvents, materializeAppendBatch, materializeCreateHeader, validateStoredEvents, } from './storage-contract.js';
/**
 * Durable append-only session storage addressed through per-session handles.
 *
 * Storage semantics shared by every backend: events are contiguous from seq 0
 * and never rewritten; a torn physical tail is never returned to a reader and
 * is truncated by the write path before its first append; reads validate
 * current-format records only and refuse unknown vocabulary fail-closed.
 * `append` persists best-effort; `flush` — per handle or service-wide — is
 * the durability barrier.
 *
 * Visibility: a created session is observable through `stat`/`list`/`open`
 * in this process from the moment `create` resolves, even while a backend
 * defers physical materialization (a pure optimization); other processes see
 * the session only once it materializes, and a session that never
 * materialized before a crash never existed. `SessionHandle.flush` forces
 * materialization.
 *
 * Freshness: once an `append` or `flush` resolves, reads started afterwards
 * on this backend instance observe at least that prefix.
 */
export class SessionPersistence extends Service {
    /** Process-local instance identity, stable through Context proxies and distinct after service replacement. */
    identity = Symbol('sessionPersistence');
    constructor(ctx) {
        super(ctx, 'sessionPersistence');
    }
}
export default SessionPersistence;
