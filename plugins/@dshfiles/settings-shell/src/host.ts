import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import { Context as EffectContext, Effect, Layer } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { decodeJson } from '@dshfiles/dshx/json'
import { z } from 'zod'
import { createSettingsTools, type SearchEntriesStore, type SettingsSurface } from './settings-tools.js'
import type { SectionEntryRow } from './settings-search.js'
import { settingsShellApi } from './shell-api.js'
import { settingsShellSettings } from './settings.js'
import { PORTED_FROM, WELCOME_PORTED_FROM } from './upstream.js'
import { checkDshRelease } from './release-check-host.js'
import type { DshReleaseStatus } from './release-status.js'

const packageVersionSchema = z.object({ version: z.string() })
const settingsProviderSchema = z.object({ documentPath: z.string() })

/** The Host settings forms, or a readable refusal when the profile serves none. */
const requireSettings = (ctx: Context): SettingsSurface => {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    throw new PluginApiError('This Host serves no settings service.', { code: 'settings-unavailable' })
  }
  return settings
}

let publishedSearchEntries: readonly SectionEntryRow[] = []
const searchEntries: SearchEntriesStore = {
  read: () => publishedSearchEntries,
  replace: entries => {
    publishedSearchEntries = entries
  },
}

class SettingsShellRuntime extends EffectContext.Service<
  SettingsShellRuntime,
  {
    readonly settings: () => SettingsSurface
    readonly documentPath: () => string | undefined
    readonly searchEntries: SearchEntriesStore
  }
>()('dshfiles/settings-shell/SettingsShellRuntime') {}

const settingsShellLayer = (ctx: Context) =>
  Layer.succeed(SettingsShellRuntime, {
    settings: () => requireSettings(ctx),
    documentPath: () => {
      const provider = settingsProviderSchema.safeParse(ctx.get('settings'))
      return provider.success ? provider.data.documentPath : undefined
    },
    searchEntries,
  })

/** A native package's version as the running `dsh` resolves it, read from beside its entry script; null when unreadable. */
const installedVersion = (packageName: string): string | null => {
  const entry = process.argv[1]
  if (entry === undefined) return null
  try {
    const require = createRequire(realpathSync(entry))
    const manifestPath = require.resolve(`${packageName}/package.json`)
    return decodeJson(packageVersionSchema, readFileSync(manifestPath, 'utf8')).version
  } catch {
    return null
  }
}

const installedUpstreamVersion = (): string | null => installedVersion(PORTED_FROM.packageName)

const RELEASE_CACHE_MS = 60 * 60 * 1000
let releaseStatusCache: { readonly expiresAt: number; readonly value: DshReleaseStatus } | undefined
let releaseStatusRequest: Promise<DshReleaseStatus> | undefined

const dshReleaseStatus = async (signal: AbortSignal): Promise<DshReleaseStatus> => {
  signal.throwIfAborted()
  if (releaseStatusCache !== undefined && releaseStatusCache.expiresAt > Date.now()) return releaseStatusCache.value
  if (releaseStatusRequest !== undefined) return releaseStatusRequest
  const request = checkDshRelease({
    currentVersion: installedVersion('@deepseek-ai/dsh'),
    fetch: globalThis.fetch,
    signal,
  }).then(value => {
    releaseStatusCache = { expiresAt: Date.now() + RELEASE_CACHE_MS, value }
    return value
  })
  releaseStatusRequest = request
  try {
    return await request
  } finally {
    if (releaseStatusRequest === request) releaseStatusRequest = undefined
  }
}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: settingsShellLayer,
  setup: (ctx: Context) =>
    Effect.sync(() => {
      for (const ported of [PORTED_FROM, WELCOME_PORTED_FROM]) {
        const installed = installedVersion(ported.packageName)
        if (installed === null || installed === ported.version) continue
        ctx
          .logger('dshfiles-settings-shell')
          .warn(
            'settings-shell: ported from %s@%s but DSH ships %s; refresh plugins/@dshfiles/settings-shell/src/native from the new package',
            ported.packageName,
            ported.version,
            installed,
          )
      }
    }),
})

const api = hostApi(settingsShellApi, {
  documentPath: Effect.fn('settings document path read')(() =>
    Effect.gen(function* () {
      const runtime = yield* SettingsShellRuntime
      return yield* Effect.sync(() => {
        const path = runtime.documentPath()
        if (path === undefined) return { path: null, exists: false }
        // The desktop opener verifies paths against their real location (macOS temp homes sit behind /var → /private/var).
        if (!existsSync(path)) return { path, exists: false }
        return { path: realpathSync(path), exists: true }
      })
    }),
  ),
  upstream: Effect.fn('settings upstream version read')(() =>
    Effect.sync(() => {
      const installed = installedUpstreamVersion()
      return { portedFrom: PORTED_FROM.version, installed, stale: installed !== null && installed !== PORTED_FROM.version }
    }),
  ),
  releaseStatus: Effect.fn('dsh release status read')(({ signal }) => Effect.tryPromise({ try: () => dshReleaseStatus(signal), catch: error => error })),
  list: Effect.fn('settings namespace list')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* SettingsShellRuntime
      return yield* createSettingsTools(runtime).list({ input })
    }),
  ),
  set: Effect.fn('settings namespace set')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* SettingsShellRuntime
      return yield* createSettingsTools(runtime).set({ input })
    }),
  ),
  unset: Effect.fn('settings namespace unset')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* SettingsShellRuntime
      return yield* createSettingsTools(runtime).unset({ input })
    }),
  ),
  publishSearchEntries: Effect.fn('settings search entries publish')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* SettingsShellRuntime
      return yield* createSettingsTools(runtime).publishSearchEntries({ input })
    }),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/settings-shell',
  settings: [settingsShellSettings],
  apis: [api],
})
