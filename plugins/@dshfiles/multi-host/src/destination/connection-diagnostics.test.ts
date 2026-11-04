import { describe, expect, test } from 'vitest'
import { connectionDiagnostics, versionMismatch } from './connection-diagnostics.js'

describe('connection diagnostics', () => {
  test('a passed test lists every step with its timing and the remote identity', () => {
    const report = connectionDiagnostics({
      sshTarget: 'm1-perso',
      remoteHome: '/Users/me/.dsh',
      localVersion: '0.2.1',
      outcome: {
        kind: 'passed',
        dshVersion: '0.2.0',
        profile: 'web',
        steps: [
          { step: 'ssh', ok: true, ms: 120 },
          { step: 'identity', ok: false, ms: 4, code: 'mismatch', message: 'profile differs' },
        ],
      },
    })
    expect(report).toContain('Host: m1-perso')
    expect(report).toContain('This machine: DSH 0.2.1')
    expect(report).toContain('Result: passed · DSH 0.2.0 · profile web')
    expect(report).toContain('- ssh: ok in 120 ms')
    expect(report).toContain('- identity: failed in 4 ms — profile differs (mismatch)')
  })

  test('a failed test keeps the error the Host reported', () => {
    const report = connectionDiagnostics({
      sshTarget: 'vps',
      remoteHome: '/home/deploy/.dsh',
      localVersion: undefined,
      outcome: { kind: 'failed', message: 'No launch file was found (runtime-not-running)' },
    })
    expect(report).toContain('This machine: DSH unknown')
    expect(report).toContain('Result: failed — No launch file was found (runtime-not-running)')
  })
})

describe('version mismatch', () => {
  test('reports the remote version only when both are known and differ', () => {
    expect(versionMismatch({ localVersion: '0.2.1', remoteVersion: '0.2.0' })).toBe('0.2.0')
    expect(versionMismatch({ localVersion: '0.2.1', remoteVersion: '0.2.1' })).toBeUndefined()
    expect(versionMismatch({ localVersion: undefined, remoteVersion: '0.2.0' })).toBeUndefined()
    expect(versionMismatch({ localVersion: '0.2.1', remoteVersion: undefined })).toBeUndefined()
  })
})
