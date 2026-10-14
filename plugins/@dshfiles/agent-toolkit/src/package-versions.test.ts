import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packageNameOf, readPackageVersions } from './package-versions.js'

let root: string | undefined
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

const writePackage = (directory: string, name: string, version: string): void => {
  mkdirSync(join(directory, 'node_modules', name), { recursive: true })
  writeFileSync(join(directory, 'node_modules', name, 'package.json'), JSON.stringify({ name, version, exports: { '.': './index.js' } }))
}

describe('package versions', () => {
  it('reads the version of a package and of a subpath entry, searching each base in order', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-toolkit-'))
    const profile = join(root, 'profile')
    const bundle = join(root, 'store', 'node_modules', 'bundle')
    writePackage(profile, '@dshfiles/btw', '0.1.0')
    writePackage(join(root, 'store'), '@deepseek-ai/dsh-tool-fs', '0.2.0-rc.2')
    mkdirSync(bundle, { recursive: true })
    expect(readPackageVersions({ packages: ['@dshfiles/btw/client', '@deepseek-ai/dsh-tool-fs', 'missing'], bases: [profile, bundle] })).toEqual({
      '@dshfiles/btw': '0.1.0',
      '@deepseek-ai/dsh-tool-fs': '0.2.0-rc.2',
      missing: null,
    })
  })

  it('names the package of a module specifier', () => {
    expect([packageNameOf('@scope/name/client'), packageNameOf('plain/sub'), packageNameOf('plain')]).toEqual(['@scope/name', 'plain', 'plain'])
  })
})
