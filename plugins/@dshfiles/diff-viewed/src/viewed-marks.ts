import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export const VIEWED_MARKS_STORAGE_KEY = 'dshfiles.diffViewed.v1'
const MAX_MARKS = 2000

export interface ViewedFile {
  readonly sessionId: string
  readonly seq: number
  readonly path: string
}

/**
 * One turn's summary is immutable while its Session lives, so a mark keyed on the
 * Session, the announcing sequence and the path can never outlive the diff it
 * reviewed: a later turn that touches the file again is a new sequence and reads as
 * unviewed.
 */
export const viewedKey = (file: ViewedFile): string => JSON.stringify([file.sessionId, file.seq, file.path])

export const createViewedMarks = (options: { readonly storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null }) => {
  const stored = createStoredValue({ key: VIEWED_MARKS_STORAGE_KEY, schema: z.array(z.string()), fallback: [], storage: options.storage })
  let snapshot: { readonly marks: readonly string[]; readonly set: ReadonlySet<string> } | null = null

  const getSnapshot = (): ReadonlySet<string> => {
    const marks = stored.get()
    if (snapshot?.marks !== marks) snapshot = { marks, set: new Set(marks) }
    return snapshot.set
  }

  const toggle = (file: ViewedFile): void => {
    const key = viewedKey(file)
    const current = getSnapshot()
    const next = [...current].filter(mark => mark !== key)
    if (!current.has(key)) next.push(key)
    stored.set(next.slice(-MAX_MARKS))
  }

  return { getSnapshot, reload: stored.reload, subscribe: stored.subscribe, toggle }
}

export type ViewedMarks = ReturnType<typeof createViewedMarks>
