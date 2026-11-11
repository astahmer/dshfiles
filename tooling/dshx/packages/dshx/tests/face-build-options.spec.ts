import { describe, expect, it } from 'vitest'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'
import { FaceBuildOptions } from '../src/compiler/options.js'
import type { JsonObject } from '../src/json.js'
import type { ResolvedDshxConfig } from '../src/tooling/index.js'

const root = '/project/plugin'

const project = (client: JsonObject): ResolvedDshxConfig => ({
  root,
  packageFile: `${root}/package.json`,
  configDependencies: [],
  packageId: '@test/plugin',
  name: '@test/plugin',
  hostEntry: `${root}/src/host.ts`,
  clientEntry: `${root}/src/client.tsx`,
  outDir: `${root}/dist`,
  profile: 'web',
  dev: { hostRestart: 'auto', hostHmr: { hostContractVersion: 'v1' } },
  build: { sourcemap: true, minify: true },
  compatibility: { allowUnsupported: false },
  manifest: { name: '@test/plugin', type: 'module', dsh: { client } },
})

const target = (value: ResolvedDshxConfig) => ({ project: value, compatibility: PROTOCOL_2_COMPATIBILITY, outDir: `${root}/staged` })

describe('FaceBuildOptions', () => {
  it('reads dsh.client external and inject and honours build.minify', () => {
    const options = FaceBuildOptions.client({
      ...target(project({ external: ['@dshfiles/shared-runtime'], inject: ['@dshfiles/ui-styles'] })),
      entry: `${root}/src/client.tsx`,
    })
    expect(options).toMatchObject({ external: ['@dshfiles/shared-runtime'], inject: ['@dshfiles/ui-styles'], minify: true, outDir: `${root}/staged` })
  })

  it('treats a dsh.client list holding a non-string as empty', () => {
    const options = FaceBuildOptions.client({ ...target(project({ external: ['@dshfiles/shared-runtime', 1] })), entry: `${root}/src/client.tsx` })
    expect(options.external).toEqual([])
  })

  it('stamps the Host generation only for dev Host HMR', () => {
    const value = project({})
    expect(FaceBuildOptions.host({ ...target(value), hostHmr: true }).generation).toEqual({ hostContractVersion: 'v1' })
    expect(FaceBuildOptions.host({ ...target(value), hostHmr: false })).not.toHaveProperty('generation')
  })
})
