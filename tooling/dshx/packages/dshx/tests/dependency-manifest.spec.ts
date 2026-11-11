import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BundleFreshness } from '../src/repository/bundle-freshness.js'

describe('bundle dependency manifest', () => {
  let directory = ''

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'dshx-deps-manifest-'))
    mkdirSync(join(directory, 'dist'))
    mkdirSync(join(directory, 'src'))
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@demo/usage', scripts: { build: 'dshx build' } }))
    writeFileSync(join(directory, 'src/host.ts'), 'export const answer = 42\n')
    writeFileSync(join(directory, 'dist/index.js'), 'export const answer = 42\n')
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  const writeManifest = (manifest: Record<string, unknown>) => writeFileSync(join(directory, 'dist/index.js.deps.json'), JSON.stringify(manifest))

  it('accepts the manifest the compiler writes', () => {
    writeManifest({ version: 1, face: 'host', sources: ['src/host.ts'], hashes: { 'src/host.ts': null } })
    expect(BundleFreshness.inspect({ directory })).toEqual({ status: 'fresh' })
  })

  it('rejects a manifest whose version no reader understands', () => {
    writeManifest({ version: 2, face: 'host', sources: ['src/host.ts'], hashes: {} })
    expect(() => BundleFreshness.inspect({ directory })).toThrow()
  })
})
