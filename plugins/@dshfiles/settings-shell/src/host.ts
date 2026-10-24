import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import type {} from '@deepseek-ai/dsh-settings'
import type { Context } from '@deepseek-ai/cordis'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { createSettingsTools, type SettingsSurface } from './settings-tools.js'
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

const settingsTools = (ctx: Context) => createSettingsTools(() => requireSettings(ctx))

/** A native package's version as the running `dsh` resolves it, read from beside its entry script; null when unreadable. */
const installedVersion = (packageName: string): string | null => {
  const entry = process.argv[1]
  if (entry === undefined) return null
  try {
    const require = createRequire(realpathSync(entry))
    const manifestPath = require.resolve(`${packageName}/package.json`)
    return packageVersionSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8'))).version
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

export default defineHost({
  name: '@dshfiles/settings-shell',
  settings: [settingsShellSettings],
  apis: [
    settingsShellApi.host({
      documentPath: async ({ ctx }) => {
        const provider = settingsProviderSchema.safeParse(ctx.get('settings'))
        if (!provider.success) return { path: null, exists: false }
        const path = provider.data.documentPath
        // The desktop opener verifies paths against their real location (macOS temp homes sit behind /var → /private/var).
        if (!existsSync(path)) return { path, exists: false }
        return { path: realpathSync(path), exists: true }
      },
      upstream: async () => {
        const installed = installedUpstreamVersion()
        return { portedFrom: PORTED_FROM.version, installed, stale: installed !== null && installed !== PORTED_FROM.version }
      },
      releaseStatus: ({ signal }) => dshReleaseStatus(signal),
      list: context => settingsTools(context.ctx).list(context),
      set: context => settingsTools(context.ctx).set(context),
      unset: context => settingsTools(context.ctx).unset(context),
    }),
  ],
  setup(ctx) {
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
  },
})
