import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { MAX_VIEWED_MARKS, viewedKey, type ViewedFile, type ViewedMarksSnapshot } from './marks-api.js'

export const viewedMarkSchema = z
  .object({
    key: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict()

export const viewedMarksDomain = defineDomain({
  name: 'diff_viewed',
  version: 1,
  tables: {
    marks: { valueSchema: viewedMarkSchema, __key: 'marks' },
  },
})

export type ViewedMark = z.infer<typeof viewedMarkSchema>
export type ViewedMarksTable = KvTable<string, ViewedMark>

/** Monotone across Host restarts: a new mark always outranks every stored version. */
export const nextMarkVersion = (current: number, now: number): number => Math.max(current + 1, now)

const byVersionAscending = (left: ViewedMark, right: ViewedMark): number => left.version - right.version

/** Keys to drop once the store exceeds its bound; the least recently written marks go first. */
export const markKeysToTrim = (marks: readonly ViewedMark[], limit = MAX_VIEWED_MARKS): readonly string[] =>
  [...marks]
    .sort(byVersionAscending)
    .slice(0, Math.max(0, marks.length - limit))
    .map(mark => mark.key)

export interface ViewedMarksStore {
  snapshot(): ViewedMarksSnapshot
  toggle(file: ViewedFile): Promise<ViewedMarksSnapshot>
  flush(): Promise<void>
}

export const createViewedMarksStore = ({
  table,
  now = Date.now,
  reportError = error => console.error('Viewed marks write failed', { error: error instanceof Error ? error.message.slice(0, 200) : typeof error }),
}: {
  readonly table: ViewedMarksTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): ViewedMarksStore => {
  const records = new Map<string, ViewedMark>(table.entries())
  let revision = Math.max(now(), ...[...records.values()].map(mark => mark.version))
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<unknown>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  const trim = (): void => {
    for (const key of markKeysToTrim([...records.values()])) {
      records.delete(key)
      void enqueue(() => table.delete(key)).catch(reportError)
    }
  }

  const put = (mark: ViewedMark): Promise<void> => {
    records.set(mark.key, mark)
    trim()
    return enqueue(() => table.put(mark.key, mark))
  }

  const snapshot = (): ViewedMarksSnapshot => ({
    revision,
    marks: [...records.values()].sort(byVersionAscending).map(mark => mark.key),
  })

  const takeVersion = (): number => {
    revision = nextMarkVersion(revision, now())
    return revision
  }

  return {
    snapshot,
    toggle: async file => {
      const key = viewedKey(file)
      if (records.has(key)) {
        records.delete(key)
        await enqueue(() => table.delete(key))
      } else {
        await put({ key, version: takeVersion() })
      }
      return snapshot()
    },
    flush: () => writes,
  }
}
