import { z } from 'zod'

export const VIEWED_MARKS_STORAGE_KEY = 'dshfiles.diffViewed.v1'
const MAX_MARKS = 2000

interface MarkStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ViewedFile {
  readonly sessionId: string
  readonly seq: number
  readonly path: string
}

const storedMarksSchema = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text)
    } catch {
      context.addIssue({ code: 'custom', message: 'stored marks are not JSON' })
      return z.NEVER
    }
  })
  .pipe(z.array(z.string()))

/**
 * One turn's summary is immutable while its Session lives, so a mark keyed on the
 * Session, the announcing sequence and the path can never outlive the diff it
 * reviewed: a later turn that touches the file again is a new sequence and reads as
 * unviewed.
 */
export const viewedKey = (file: ViewedFile): string => JSON.stringify([file.sessionId, file.seq, file.path])

const readMarks = (storage: MarkStorage): readonly string[] => {
  const parsed = storedMarksSchema.safeParse(storage.getItem(VIEWED_MARKS_STORAGE_KEY))
  return parsed.success ? parsed.data : []
}

export const createViewedMarks = (options: { readonly storage: MarkStorage }) => {
  let snapshot: ReadonlySet<string> = new Set(readMarks(options.storage))
  const listeners = new Set<() => void>()

  const toggle = (file: ViewedFile): void => {
    const key = viewedKey(file)
    const next = [...snapshot].filter(mark => mark !== key)
    if (!snapshot.has(key)) next.push(key)
    const kept = next.slice(-MAX_MARKS)
    options.storage.setItem(VIEWED_MARKS_STORAGE_KEY, JSON.stringify(kept))
    snapshot = new Set(kept)
    for (const listener of listeners) listener()
  }

  /** Another window wrote the marks: adopt its list so this one stops showing stale state. */
  const reload = (): void => {
    snapshot = new Set(readMarks(options.storage))
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: (): ReadonlySet<string> => snapshot,
    reload,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    toggle,
  }
}

export type ViewedMarks = ReturnType<typeof createViewedMarks>
