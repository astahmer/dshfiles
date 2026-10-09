import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

const MAX_ENTRIES = 200
const HOUR_MS = 3_600_000

const frecencySchema = z
  .array(
    z.object({
      id: z.string().min(1).max(4200),
      count: z.number().int().min(1).max(100_000),
      lastUsedAt: z.number().int().nonnegative(),
    }),
  )
  .max(MAX_ENTRIES)

export type FrecencyEntries = z.infer<typeof frecencySchema>

/** Palette picks (actions, Host commands, files) in this browser; threads keep their own recency ranking. */
export const paletteFrecency = createStoredValue({ key: 'dshfiles.thread-sidebar.palette-frecency.v1', schema: frecencySchema, fallback: [] })

const recencyWeight = (ageMs: number): number => {
  if (ageMs < 4 * HOUR_MS) return 4
  if (ageMs < 24 * HOUR_MS) return 2
  if (ageMs < 7 * 24 * HOUR_MS) return 1
  return 0.5
}

const score = (entry: FrecencyEntries[number], now: number): number => entry.count * recencyWeight(now - entry.lastUsedAt)

/** Ranking bonus per id, capped so a habit lifts an entry without beating a clearly better text match. */
export const frecencyBoosts = (entries: FrecencyEntries, now: number): ReadonlyMap<string, number> =>
  new Map(entries.map(entry => [entry.id, Math.min(score(entry, now), 40) * 20]))

/** Count one use, then keep the highest-scoring entries so storage stays bounded. */
export const recordUse = (entries: FrecencyEntries, id: string, now: number): FrecencyEntries => {
  const previous = entries.find(entry => entry.id === id)
  const used = { id, count: Math.min((previous?.count ?? 0) + 1, 100_000), lastUsedAt: now }
  return [used, ...entries.filter(entry => entry.id !== id)].sort((left, right) => score(right, now) - score(left, now)).slice(0, MAX_ENTRIES)
}
