import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { settingsShellApi } from './shell-api.js'
import { PORTED_FROM } from './upstream.js'

const packageVersionSchema = z.object({ version: z.string() })
const settingsProviderSchema = z.object({ documentPath: z.string() })

/** The native Settings package the running `dsh` resolves, read from beside its entry script; null when unreadable. */
const installedUpstreamVersion = (): string | null => {
  const entry = process.argv[1]
  if (entry === undefined) return null
  try {
    const require = createRequire(realpathSync(entry))
    return packageVersionSchema.parse(require(`${PORTED_FROM.packageName}/package.json`)).version
  } catch {
    return null
  }
}

export default defineHost({
  name: '@dshfiles/settings-shell',
  apis: [
    settingsShellApi.host({
      documentPath: async ({ ctx }) => {
        const provider = settingsProviderSchema.safeParse(ctx.get('settings'))
        return { path: provider.success ? provider.data.documentPath : null }
      },
      upstream: async () => {
        const installed = installedUpstreamVersion()
        return { portedFrom: PORTED_FROM.version, installed, stale: installed !== null && installed !== PORTED_FROM.version }
      },
    }),
  ],
  setup(ctx) {
    const installed = installedUpstreamVersion()
    if (installed !== null && installed !== PORTED_FROM.version) {
      ctx
        .logger('dshfiles-settings-shell')
        .warn(
          'settings-shell: ported from %s@%s but DSH ships %s; refresh plugins/@dshfiles/settings-shell/src/native from the new package',
          PORTED_FROM.packageName,
          PORTED_FROM.version,
          installed,
        )
    }
  },
})
