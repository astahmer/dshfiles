import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HmrGateModel, digestOf, hostArtifactOf } from './gate.js'

const packageWith = (manifest: object, entryPath: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'hmr-gate-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  mkdirSync(join(root, entryPath, '..'), { recursive: true })
  writeFileSync(join(root, entryPath), 'export const value = 1\n')
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/client.js'), 'window.x = 1\n')
  return join(root, 'dist/client.js')
}

describe('hostArtifactOf', () => {
  it('reads an owned bundle entry from exports', () => {
    const clientPath = packageWith({ exports: { '.': './dist/index.js' } }, 'dist/index.js')
    expect(hostArtifactOf(clientPath)?.endsWith('/dist/index.js')).toBe(true)
  })

  it('reads a native package entry from main', () => {
    const clientPath = packageWith({ main: './lib/index.js' }, 'lib/index.js')
    expect(hostArtifactOf(clientPath)?.endsWith('/lib/index.js')).toBe(true)
  })

  it('returns undefined for a client-only package', () => {
    const clientPath = packageWith({ exports: { '.': './dist/index.js' } }, 'dist/client.js')
    expect(hostArtifactOf(clientPath)).toBeUndefined()
  })
})

describe('HmrGateModel', () => {
  it('applies a client rebuild while the Host half is the loaded one', () => {
    const gate = new HmrGateModel()
    gate.track('pkg', '/pkg/dist/index.js', 'loaded-digest')
    expect(gate.observe('pkg', 'loaded-digest')).toEqual({ action: 'apply' })
    expect(gate.deferred()).toEqual([])
  })

  it('defers while the Host half on disk is not the loaded one', () => {
    const gate = new HmrGateModel()
    gate.track('pkg', '/pkg/dist/index.js', 'loaded-digest')
    expect(gate.observe('pkg', 'rebuilt-digest')).toEqual({ action: 'defer', reason: 'host-artifact-changed' })
    expect(gate.deferred()).toEqual(['pkg'])
  })

  it('releases a deferral when the Host reloaded that artifact', () => {
    const gate = new HmrGateModel()
    gate.track('pkg', '/pkg/dist/index.js', 'loaded-digest')
    gate.observe('pkg', 'rebuilt-digest')
    expect(gate.release(['/other/index.js'])).toEqual([])
    expect(gate.release(['/pkg/dist/index.js'])).toEqual(['pkg'])
    expect(gate.deferred()).toEqual([])
    expect(gate.facts('pkg')).toMatchObject({ loaded: 'rebuilt-digest', disk: 'rebuilt-digest' })
  })

  it('always applies a package without a Host half', () => {
    const gate = new HmrGateModel()
    gate.track('client-only', undefined, undefined)
    expect(gate.observe('client-only', 'anything')).toEqual({ action: 'apply' })
    expect(gate.deferred()).toEqual([])
  })
})

describe('digestOf', () => {
  it('reads file content and tolerates a missing file', () => {
    const clientPath = packageWith({ exports: { '.': './dist/index.js' } }, 'dist/index.js')
    const hostPath = hostArtifactOf(clientPath)
    expect(hostPath).toBeDefined()
    expect(digestOf(hostPath ?? '')).toMatch(/^[0-9a-f]{64}$/)
    expect(digestOf(join(clientPath, 'missing.js'))).toBeUndefined()
  })
})
