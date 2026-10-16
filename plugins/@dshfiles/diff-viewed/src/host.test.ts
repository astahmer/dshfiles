import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import type { ViewedMark } from './marks-store.js'

/**
 * Wiring check for the Host half: the built bundle injects the storage domain,
 * opens the `diff_viewed` domain its API reads, and closes it with a flush
 * when the plugin unloads. The store tests cover what the marks hold; this
 * proves the plugin actually reaches durable storage.
 */

const builtEntry = new URL('../dist/index.js', import.meta.url).href

const table = (rows: Map<string, ViewedMark>) => ({
  get: (key: string) => rows.get(key),
  entries: () => rows.entries(),
  keys: () => rows.keys(),
  get size() {
    return rows.size
  },
  put: async (key: string, value: ViewedMark) => {
    rows.set(key, value)
  },
  delete: async (key: string) => rows.delete(key),
  update: async (key: string, change: (current: ViewedMark) => ViewedMark) => {
    const current = rows.get(key)
    if (current === undefined) throw new Error('missing row')
    const next = change(current)
    rows.set(key, next)
    return next
  },
})

interface HarnessDomain {
  readonly table: () => ReturnType<typeof table>
  readonly close: () => Promise<void>
}

interface HarnessSettings {
  readonly configure: () => () => undefined
  readonly describe: () => readonly string[]
  readonly update: () => Promise<void>
  readonly replace: () => Promise<void>
}

interface HarnessContext {
  readonly on: () => void
  readonly once: () => void
  readonly emit: () => void
  readonly parallel: () => void
  readonly serial: () => void
  readonly bail: () => void
  readonly waterfall: () => void
  readonly effect: (callback: () => void | (() => void)) => void
  readonly get: (name: string) => { readonly open: (domain: DomainSpec) => Promise<HarnessDomain> } | undefined
  readonly inject: () => void
  readonly settings: HarnessSettings
}

interface BuiltPlugin {
  readonly name: string
  readonly inject: readonly string[] | undefined
  readonly apply: (ctx: HarnessContext) => Promise<void> | void
}

interface OpenedDomain {
  readonly name: string
  readonly version: number
  readonly tables: readonly string[]
}

const startHarness = async () => {
  // SAFETY: the built entry is createHostModule's bundle, whose apply takes any context object.
  const plugin = (await import(builtEntry)) as BuiltPlugin
  const rows = new Map<string, ViewedMark>()
  const opened: OpenedDomain[] = []
  const disposers: (() => void | Promise<void>)[] = []
  let tableReads = 0
  let closes = 0
  const ignore = (): void => undefined
  const ctx: HarnessContext = {
    on: ignore,
    once: ignore,
    emit: ignore,
    parallel: ignore,
    serial: ignore,
    bail: ignore,
    waterfall: ignore,
    effect: callback => {
      const disposer = callback()
      if (disposer !== undefined) disposers.push(disposer)
    },
    get: name =>
      name === 'storageDomain'
        ? {
            open: async (domain: DomainSpec) => {
              opened.push({ name: domain.name, version: domain.version, tables: Object.keys(domain.tables) })
              return {
                table: () => {
                  tableReads += 1
                  return table(rows)
                },
                close: async () => {
                  closes += 1
                },
              }
            },
          }
        : undefined,
    inject: ignore,
    settings: {
      configure: () => () => undefined,
      describe: () => [],
      update: async () => undefined,
      replace: async () => undefined,
    },
  }
  await plugin.apply(ctx)
  return {
    plugin,
    rows,
    opened,
    get tableReads() {
      return tableReads
    },
    get closes() {
      return closes
    },
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}

describe('diff-viewed Host wiring', () => {
  it('opens the durable marks domain and closes it on unload', async () => {
    const harness = await startHarness()

    expect(harness.plugin.name).toBe('@dshfiles/diff-viewed')
    expect(harness.plugin.inject).toContain('storageDomain')
    expect(harness.opened).toEqual([{ name: 'diff_viewed', version: 1, tables: ['marks'] }])
    expect(harness.tableReads).toBe(1)
    expect(harness.rows.size).toBe(0)

    await harness.dispose()
    expect(harness.closes).toBe(1)
  })
})
