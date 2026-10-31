import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { agentToolkitApi } from './api.js'
import { readPackageVersions } from './package-versions.js'

/**
 * The profile directory, then each `@deepseek-ai` bundle it installs: DSH's built-in plugins are those bundles'
 * dependencies, reachable only from the bundle's own (pnpm-isolated) location.
 */
const searchBases = async (ctx: Context): Promise<readonly string[]> => {
  const baseUrl = z.string().startsWith('file:').safeParse(ctx.baseUrl)
  if (!baseUrl.success) return []
  const profile = fileURLToPath(baseUrl.data)
  const scope = join(profile, 'node_modules', '@deepseek-ai')
  const bundles = await readdir(scope).catch(() => [])
  const resolved = await Promise.all(bundles.map(name => realpath(join(scope, name)).catch(() => undefined)))
  return [profile, ...resolved.filter(path => path !== undefined)]
}

export default defineHost({
  apis: [
    agentToolkitApi.host({
      versions: async ({ input, ctx }) => readPackageVersions({ packages: input.packages, bases: await searchBases(ctx) }),
    }),
  ],
})
