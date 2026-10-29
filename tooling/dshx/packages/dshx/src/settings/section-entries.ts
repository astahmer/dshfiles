/**
 * Search entries a `settings.section` publishes so a Settings shell can index its controls without mounting it.
 * The native slot ledger keeps only `id`/`order`/`label`/`priority`, so the entries ride a browser-local seat shared by
 * every DSHX Client bundle (each bundles its own copy of this module), like the Plugins-page renderer seat. The seat
 * holds what each bundle published; a reader decodes it with `section-entries-schema.ts`, which stays out of this
 * module so every Client bundle without a shared zod does not inline it.
 */
/** One control a section can scroll to: `id` comes back as the section's `target` prop. */
export interface SettingsSearchEntry {
  readonly id: string
  readonly title: string
  readonly description?: string | undefined
  readonly keywords?: string | undefined
}

/** `metadata` a `settings.section` contribution may carry. */
export interface SettingsSectionMetadata {
  /** ConfigForm entry ids whose field targets this section handles. */
  readonly settingsTargets?: readonly string[] | undefined
  /** Controls a Settings search finds while the section is unmounted. */
  readonly searchEntries?: readonly SettingsSearchEntry[] | undefined
}

/** Owner prop a section receives when Settings opens it from one of its search entries. */
export interface SettingsSectionSearchProps {
  /** The picked entry's `id`; scroll to and focus that control. */
  readonly target?: string | undefined
}

/** Every live section's entries as published, keyed by section id; decode before use. */
export type SettingsSearchEntriesBySection = ReadonlyMap<string, unknown>

interface EntriesSeat {
  bySection: SettingsSearchEntriesBySection
  readonly listeners: Set<() => void>
}

declare global {
  // Shared by every DSHX Client bundle on the page; the version suffix changes with an incompatible seat.
  var __dshxSettingsSearchEntriesV1: EntriesSeat | undefined
}

const seat = (): EntriesSeat => {
  globalThis.__dshxSettingsSearchEntriesV1 ??= { bySection: new Map(), listeners: new Set() }
  return globalThis.__dshxSettingsSearchEntriesV1
}

const replace = (current: EntriesSeat, update: (next: Map<string, unknown>) => void): void => {
  const next = new Map(current.bySection)
  update(next)
  current.bySection = next
  current.listeners.forEach(listener => listener())
}

/** Publish one section's entries until the returned disposer runs; a later publish for the same section replaces it. */
const publishSettingsSearchEntries = (input: { readonly sectionId: string; readonly entries: readonly SettingsSearchEntry[] }): (() => void) => {
  const current = seat()
  const entries = input.entries
  replace(current, next => next.set(input.sectionId, entries))
  return () => {
    if (current.bySection.get(input.sectionId) !== entries) return
    replace(current, next => next.delete(input.sectionId))
  }
}

/** The current entries; the map's identity changes exactly when an entry set does. */
const settingsSearchEntries = (): SettingsSearchEntriesBySection => seat().bySection

const subscribeSettingsSearchEntries = (listener: () => void): (() => void) => {
  const current = seat()
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
  }
}

export class SettingsSearchEntriesModel {
  static readonly publish = publishSettingsSearchEntries
  static readonly current = settingsSearchEntries
  static readonly subscribe = subscribeSettingsSearchEntries
}
