/**
 * Undo, rewind and redo as rows of the composer's More menu (polish pass b:r4et). The rows are plain data the composer
 * draws; picking one sends its verb to the `UndoControl` mounted in that thread's composer, which owns the mutation, the
 * rewind list and the confirmation dialog either way. Availability is what that control last read for its thread.
 */
export type UndoVerb = 'undo' | 'rewind' | 'redo'

export interface UndoAvailability {
  readonly undo: boolean
  readonly rewind: boolean
  readonly redo: boolean
}

const NONE: UndoAvailability = { undo: false, rewind: false, redo: false }
const availability = new Map<string, UndoAvailability>()

const listeners = new Map<string, Set<(verb: UndoVerb) => void>>()

/** Picking a row sends its verb to the control of that thread's composer, which listens with `on`. */
export const undoRequests = {
  send(sessionId: string, verb: UndoVerb): void {
    for (const listener of listeners.get(sessionId) ?? []) listener(verb)
  },
  on(sessionId: string, listener: (verb: UndoVerb) => void): () => void {
    const set = listeners.get(sessionId) ?? new Set()
    set.add(listener)
    listeners.set(sessionId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(sessionId)
    }
  },
}

export class UndoRows {
  static readonly set = (sessionId: string, value: UndoAvailability): void => {
    availability.set(sessionId, value)
  }
  static readonly clear = (sessionId: string): void => {
    availability.delete(sessionId)
  }
  static readonly get = (sessionId: string): UndoAvailability => availability.get(sessionId) ?? NONE
}
