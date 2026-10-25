import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

export const fakeTable = <Value>(initial: Iterable<[string, Value]> = []): KvTable<string, Value> => {
  const rows = new Map<string, Value>(initial)
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async key => rows.delete(key),
    update: async (key, fn) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing-key')
      const next = fn(current)
      rows.set(key, next)
      return next
    },
  }
}
