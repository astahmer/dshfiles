import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { agentToolkitApi } from './api.js'
import { PackageVersionsReadError, readPackageVersionsEffect } from './package-versions.js'

/**
 * The profile directory, then each `@deepseek-ai` bundle it installs: DSH's built-in plugins are those bundles'
 * dependencies, reachable only from the bundle's own (pnpm-isolated) location.
 */
const fileUrlSchema = Schema.String.check(Schema.isPattern(/^file:/u))

const searchBases = async (ctx: CordisContext): Promise<readonly string[]> => {
  if (!Schema.is(fileUrlSchema)(ctx.baseUrl)) return []
  const profile = fileURLToPath(ctx.baseUrl)
  const scope = join(profile, 'node_modules', '@deepseek-ai')
  const bundles = await readdir(scope).catch(() => [])
  const resolved = await Promise.all(bundles.map(name => realpath(join(scope, name)).catch(() => undefined)))
  return [profile, ...resolved.filter(path => path !== undefined)]
}

class AgentToolkitRuntime extends EffectContext.Service<
  AgentToolkitRuntime,
  { readonly versions: (packages: readonly string[]) => Effect.Effect<Record<string, string | null>, PackageVersionsReadError> }
>()('@dshfiles/agent-toolkit/Runtime') {}

const operationsLayer = (ctx: CordisContext) =>
  Layer.succeed(AgentToolkitRuntime, {
    versions: (packages: readonly string[]) => readPackageVersionsEffect({ packages, bases: () => searchBases(ctx) }),
  })

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: operationsLayer, setup: () => Effect.void })
const api = hostApi(agentToolkitApi, {
  versions: ({ input }) => AgentToolkitRuntime.use(runtime => runtime.versions(input.packages)),
})

export default defineHost({ ...effectPlugin, apis: [api] })
