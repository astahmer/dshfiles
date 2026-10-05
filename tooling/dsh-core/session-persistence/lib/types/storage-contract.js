/**
 * Backend-shared storage validation: the version gate, the fail-closed event
 * vocabulary, append-batch materialization, and contiguity — one place so
 * every backend refuses the same inputs identically.
 * @module @deepseek-ai/dsh-session-persistence/storage-contract
 */
import { adoptSessionEvent, decodeSessionEvent, KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, } from '@deepseek-ai/dsh-session';
import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values';
import { SessionFormatUnsupportedError, SessionPersistenceCorruptionError, sessionFormatVersionRefusal, } from './errors.js';
/** Build a format refusal that points at the raw artifact when the backend has one. */
function unsupported(reason, location) {
    return new SessionFormatUnsupportedError(location === undefined ? reason : `${reason} (raw log: ${location.path})`, location);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function assertKnownEventType(meta, type, seq, ignorable, location) {
    if (!KNOWN_SESSION_EVENT_TYPES.has(type) && ignorable !== true) {
        throw unsupported(`session "${meta.id}" contains event type "${type}" (seq ${String(seq)}) unknown to this harness and not marked ignorable; refusing to interpret the log — it was likely written by a newer harness`, location);
    }
}
export function assertNoRetiredStoredEvent(meta, value, location) {
    if (!isRecord(value) || value['type'] !== 'request/header')
        return;
    const data = value['data'];
    if (!isRecord(data) || data['reason'] !== 'fallback')
        return;
    throw unsupported(`session "${meta.id}" contains a request/header event (seq ${String(value['seq'])}) with the unsupported legacy reason "fallback"; refusing to interpret the log — it was written by a retired pre-release harness`, location);
}
/**
 * Refuse stored metadata that is not bound to the requested session id.
 * @param id - the requested session id.
 * @param meta - the stored header.
 */
export function assertStoredId(id, meta) {
    if (meta.id !== id) {
        throw new Error(`stored session identity mismatch: requested "${id}", header contains "${meta.id}"`);
    }
}
/**
 * Refuse a header that has not been restored to the current logical format.
 * @param meta - the stored header.
 * @param location - the backend's artifact location for the refusal, when one exists.
 */
export function assertVersion(meta, location) {
    if (meta.version !== SESSION_FORMAT_VERSION) {
        throw unsupported(sessionFormatVersionRefusal(meta.id, meta.version), location);
    }
}
/**
 * Validate one exclusively owned stored event array in place: adopt each
 * record (validating and freezing it) and refuse any event type this build
 * does not know, unless its writer marked it `ignorable: true` — silently
 * skipping an unknown required event could reconstruct a wrong session (the
 * envelope contract on `SessionEvent.ignorable`). Unknown required types and
 * retired pre-release shapes refuse here; this validator performs no migration.
 * @param meta - the stored header the events belong to.
 * @param events - exclusively owned decoded events; validated in place.
 * @param location - the backend's artifact location for refusals, when one exists.
 * @returns the same array, validated and frozen.
 * @throws {SessionFormatUnsupportedError} for unknown event types.
 * @throws {SessionPersistenceCorruptionError} for records that fail validation.
 */
export function validateStoredEvents(meta, events, location) {
    for (const event of events) {
        assertKnownEventType(meta, event.type, event.seq, event.ignorable, location);
        assertNoRetiredStoredEvent(meta, event, location);
    }
    try {
        for (const [index, event] of events.entries())
            events[index] = adoptSessionEvent(event);
    }
    catch (error) {
        if (error instanceof SessionFormatUnsupportedError)
            throw error;
        throw new SessionPersistenceCorruptionError(`stored session "${meta.id}" failed validation: ${String(error)}`, { cause: error });
    }
    return events;
}
/** Decode and validate events emitted by a generic persisted-format reader. */
export function decodeStoredEvents(meta, values, location) {
    return Array.from(values, (value, index) => {
        if (isRecord(value) && typeof value['type'] === 'string') {
            assertKnownEventType(meta, value['type'], value['seq'], value['ignorable'], location);
        }
        assertNoRetiredStoredEvent(meta, value, location);
        try {
            return adoptSessionEvent(decodeSessionEvent(value, index));
        }
        catch (error) {
            if (error instanceof SessionFormatUnsupportedError)
                throw error;
            throw new SessionPersistenceCorruptionError(`stored session "${meta.id}" failed validation: ${String(error)}`, { cause: error });
        }
    });
}
/**
 * Validate and deep-snapshot a header passed to `create` in one traversal.
 * @param header - the caller's header.
 * @returns the detached lossless-JSON header.
 * @throws {TypeError} for non-JSON metadata or an invalid `createdAt`.
 */
export function materializeCreateHeader(header) {
    const snapshot = snapshotJsonValue(header);
    if (snapshot === undefined) {
        throw new TypeError('session metadata must be losslessly JSON-serializable');
    }
    if (!Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0) {
        throw new TypeError('session metadata createdAt must be a non-negative safe integer');
    }
    return snapshot;
}
/**
 * Validate and deep-snapshot one append batch in a single traversal, so the
 * checked value is exactly the value persisted (a check followed by a copy
 * could reread accessors into a different record).
 * @param events - the caller's batch.
 * @returns the detached lossless-JSON batch.
 * @throws {TypeError} when any event data is not losslessly JSON-serializable.
 */
export function materializeAppendBatch(events) {
    const batch = snapshotJsonValue(events);
    if (batch === undefined) {
        throw new TypeError('session event batch is not losslessly JSON-serializable because it contains non-JSON-serializable data');
    }
    return batch;
}
/**
 * Refuse a batch that does not contiguously continue the stored log.
 * @param id - the session the batch belongs to.
 * @param events - the batch, in seq order.
 * @param cursor - the stored next-seq.
 */
export function assertContiguous(id, events, cursor) {
    for (const [index, event] of events.entries()) {
        if (event.seq !== cursor + index) {
            throw new Error(`append seq mismatch for "${id}": expected ${cursor + index} at index ${index}, got ${event.seq}`);
        }
    }
}
