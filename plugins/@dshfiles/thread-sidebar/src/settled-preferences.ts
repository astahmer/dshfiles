/**
 * Where the page reads the settled status from. The Host keeps it in its own store and serves it through the
 * `thread-sidebar-settled` API; a Host started before that store answers the read with `bad-request` (unknown method) and still
 * keeps it in the two settings fields, so the page reads and writes those as before.
 */
import { isApiError, isApiOwnerMissing } from '@dshfiles/dshx/api'
import type { SidebarPreferences } from './organization.js'
import type { SettledStatus } from './settled-threads.js'

export type SettledSource =
  /** The Host store answered. */
  | { readonly kind: 'store'; readonly status: SettledStatus }
  /** Not answered yet: the settings fields stand in, as they did before the store existed. */
  | { readonly kind: 'pending' }
  /** An older Host, or no Host API at all: the settings fields are the status. */
  | { readonly kind: 'settings' }

/** An older Host does not serve the read; the API owner being absent means no Host half either. */
const notServed = (error: unknown): boolean => isApiError(error) && (isApiOwnerMissing(error) || error.remoteCode === 'bad-request')

const sourceOf = (
  read: { readonly data: { readonly settledSessionIds: readonly string[]; readonly settledAt: Readonly<Record<string, number>> } | undefined; readonly error: unknown } | null,
): SettledSource => {
  if (read === null) return { kind: 'settings' }
  if (read.data !== undefined) return { kind: 'store', status: { settledSessionIds: [...read.data.settledSessionIds], settledAt: { ...read.data.settledAt } } }
  return read.error !== undefined && notServed(read.error) ? { kind: 'settings' } : { kind: 'pending' }
}

/** The preferences every reader sees: the settings value with the store's settled status (and a write not yet answered). */
const merge = (preferences: SidebarPreferences, source: SettledSource, optimistic: SettledStatus | null): SidebarPreferences => {
  if (source.kind === 'settings') return preferences
  const status = optimistic ?? (source.kind === 'store' ? source.status : null)
  return status === null ? preferences : { ...preferences, settledSessionIds: status.settledSessionIds, settledAt: status.settledAt }
}

/** A preferences patch split into its settled part (the store's) and the rest (Settings'). */
export interface SplitPatch {
  readonly settled: Pick<Partial<SidebarPreferences>, 'settledSessionIds' | 'settledAt'> | null
  readonly rest: Partial<SidebarPreferences>
}

const split = (patch: Partial<SidebarPreferences>): SplitPatch => {
  const { settledSessionIds, settledAt, ...rest } = patch
  if (settledSessionIds === undefined && settledAt === undefined) return { settled: null, rest }
  return { settled: { ...(settledSessionIds !== undefined && { settledSessionIds }), ...(settledAt !== undefined && { settledAt }) }, rest }
}

export class SettledPreferencesModel {
  static readonly notServed = notServed
  static readonly sourceOf = sourceOf
  static readonly merge = merge
  static readonly split = split
}
