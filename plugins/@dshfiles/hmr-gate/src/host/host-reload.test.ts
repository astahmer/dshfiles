import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { recordSpans } from '@dshfiles/dshx/tracing'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { HostReload } from './host-reload.js'

const roots: string[] = []
interface TestManifest {
  readonly name: string
  readonly dshx?: { readonly features?: string; readonly hostReload?: string }
}

const packageWith = (manifest: TestManifest): string => {
  const root = mkdtempSync(join(tmpdir(), 'host-reload-'))
  roots.push(root)
  mkdirSync(join(root, 'dist'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'dist', 'index.js'), 'export const name = "x"\n')
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('host reload opt-in', () => {
  it('names the package only when its manifest declares dshx.hostReload "safe"', () => {
    const optedIn = packageWith({ name: '@dshfiles/pilot', dshx: { features: './dshx.features.json', hostReload: 'safe' } })
    const plain = packageWith({ name: '@dshfiles/plain', dshx: { features: './dshx.features.json' } })
    const invalid = packageWith({ name: '@dshfiles/invalid', dshx: { hostReload: 'always' } })
    expect(HostReload.optedInPackage(join(optedIn, 'dist', 'index.js'))).toBe('@dshfiles/pilot')
    expect(HostReload.optedInPackage(join(plain, 'dist', 'index.js'))).toBeUndefined()
    expect(HostReload.optedInPackage(join(invalid, 'dist', 'index.js'))).toBeUndefined()
  })
})

describe('host reload Loader contract', () => {
  const apply = () => undefined
  it('accepts a code-only change and refuses a changed name, inject or Config', () => {
    const base = HostReload.contractOf({ name: 'dshfiles-pilot', inject: ['tools'], apply })
    expect(HostReload.contractOf({ name: 'dshfiles-pilot', inject: ['tools'], apply: () => 1 })).toBe(base)
    expect(HostReload.contractOf({ name: 'dshfiles-other', inject: ['tools'], apply })).not.toBe(base)
    expect(HostReload.contractOf({ name: 'dshfiles-pilot', inject: ['tools', 'agents'], apply })).not.toBe(base)
    const configWithJsonForm = { '~standard': Schema.toStandardSchemaV1(Schema.Unknown)['~standard'], toJSON: () => ({ a: 1 }) }
    expect(HostReload.contractOf({ name: 'dshfiles-pilot', inject: ['tools'], Config: configWithJsonForm, apply })).not.toBe(base)
  })
})

describe('host reload eviction set', () => {
  it('selects the package own files, never its node_modules or another package', () => {
    const root = '/workspace/plugins/@dshfiles/pilot'
    const own = `${pathToFileURL(root).href}/dist/index.js`
    const chunk = `${pathToFileURL(root).href}/dist/chunk-a.js`
    const cache = new Map<unknown, unknown>([
      [own, 1],
      [chunk, 1],
      [`${pathToFileURL(root).href}/node_modules/effect/index.js`, 1],
      [`${pathToFileURL(`${root}-two`).href}/dist/index.js`, 1],
      ['node:fs', 1],
    ])
    expect(HostReload.packageUrls(cache, root)).toEqual([own, chunk])
  })
})

describe('host reload span', () => {
  it('records a host-reload apply span naming the package and refuses without a Loader', async () => {
    using recorder = recordSpans()
    const root = packageWith({ name: '@dshfiles/pilot', dshx: { hostReload: 'safe' } })
    const outcome = await HostReload.reload(new Context(), join(root, 'dist', 'index.js'), '@dshfiles/pilot')
    expect(outcome).toEqual({ kind: 'refused', reason: 'no-loader' })
    expect(recorder.span('host-reload apply').attributes).toEqual({ 'dshfiles.plugin.package': '@dshfiles/pilot' })
  })
})
