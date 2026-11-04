import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'

const MAX_ENTRIES = 200
const HOUR_MS = 3_600_000

const frecencySchema = Schema.Array(
  Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4200)),
    count: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100_000)),
    lastUsedAt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  }),
).check(Schema.isMaxLength(MAX_ENTRIES))

export type FrecencyEntries = typeof frecencySchema.Type

/**
 * Palette picks (actions, Host commands, files) in this browser; threads keep their own recency ranking. The stored-value
 * hook still takes a zod-shaped schema, so the Effect schema is the source of truth behind `zodSchemaFromEffect`.
 */
export const paletteFrecency = createStoredValue({
  key: 'dshfiles.thread-sidebar.palette-frecency.v1',
  schema: frecencySchema,
  fallback: [],
})

const recencyWeight = (ageMs: number): number => {
  if (ageMs < 4 * HOUR_MS) return 4
  if (ageMs < 24 * HOUR_MS) return 2
  if (ageMs < 7 * 24 * HOUR_MS) return 1
  return 0.5
}

const score = (entry: FrecencyEntries[number], now: number): number => entry.count * recencyWeight(now - entry.lastUsedAt)

/** Ranking bonus per id, capped so a habit lifts an entry without beating a clearly better text match. */
const frecencyBoosts = (entries: FrecencyEntries, now: number): ReadonlyMap<string, number> =>
  new Map(entries.map(entry => [entry.id, Math.min(score(entry, now), 40) * 20]))

/** Count one use, then keep the highest-scoring entries so storage stays bounded. */
const recordUse = (entries: FrecencyEntries, id: string, now: number): FrecencyEntries => {
  const previous = entries.find(entry => entry.id === id)
  const used = { id, count: Math.min((previous?.count ?? 0) + 1, 100_000), lastUsedAt: now }
  return [used, ...entries.filter(entry => entry.id !== id)].sort((left, right) => score(right, now) - score(left, now)).slice(0, MAX_ENTRIES)
}

export class PaletteFrecency {
  static readonly boosts = frecencyBoosts
  static readonly recordUse = recordUse
}
