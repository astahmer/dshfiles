import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isOwnerOnly, LocalEndpoint } from '../src/bridge/local-endpoint.js'

const shortAddress = { socketPath: join(tmpdir(), 'h', 'host.sock'), shortName: 'dshx-comm-0123456789abcdef0123' }
const deepAddress = { socketPath: join(tmpdir(), 'x'.repeat(100), 'host.sock'), shortName: 'dshx-comm-0123456789abcdef0123' }

describe('LocalEndpoint', () => {
  it('keeps a POSIX socket beside its metadata, or a short temp path when that one is too long for AF_UNIX', () => {
    expect(LocalEndpoint.listenPath(shortAddress, 'linux')).toBe(shortAddress.socketPath)
    expect(LocalEndpoint.listenPath(deepAddress, 'darwin')).toBe(join(tmpdir(), 'dshx-comm-0123456789abcdef0123.sock'))
    expect(LocalEndpoint.accepts(shortAddress, shortAddress.socketPath, 'linux')).toBe(true)
    expect(LocalEndpoint.accepts(shortAddress, join(tmpdir(), 'other.sock'), 'linux')).toBe(false)
  })

  it('gives a Windows Host a fresh named pipe per run that its clients accept and others do not', () => {
    const first = LocalEndpoint.listenPath(shortAddress, 'win32')
    const second = LocalEndpoint.listenPath(shortAddress, 'win32')
    expect(first).toMatch(/^\\\\\.\\pipe\\dshx-comm-0123456789abcdef0123-[0-9a-f]{24}$/u)
    expect(second).not.toBe(first)
    expect(LocalEndpoint.isNamedPipe(first)).toBe(true)
    expect(LocalEndpoint.accepts(shortAddress, first, 'win32')).toBe(true)
    expect(LocalEndpoint.accepts(shortAddress, '\\\\.\\pipe\\dshx-comm-0123456789abcdef0123', 'win32')).toBe(false)
    expect(LocalEndpoint.accepts(shortAddress, '\\\\.\\pipe\\dshx-comm-ffffffffffffffffffff-0123456789abcdef01234567', 'win32')).toBe(false)
    expect(LocalEndpoint.accepts(shortAddress, shortAddress.socketPath, 'win32')).toBe(false)
  })

  it('leaves a named pipe to its server instead of chmod or rm', async () => {
    // Either call on a live pipe would open a client connection or fail with EINVAL; on a missing one it would throw.
    await expect(LocalEndpoint.restrict('\\\\.\\pipe\\dshx-test-missing')).resolves.toBeUndefined()
    await expect(LocalEndpoint.remove('\\\\.\\pipe\\dshx-test-missing')).resolves.toBeUndefined()
  })
})

describe('isOwnerOnly', () => {
  it('rejects group or other access on POSIX and defers to the ACL on Windows', () => {
    expect(isOwnerOnly({ mode: 0o100600 }, 'linux')).toBe(true)
    expect(isOwnerOnly({ mode: 0o40700 }, 'darwin')).toBe(true)
    expect(isOwnerOnly({ mode: 0o100640 }, 'linux')).toBe(false)
    expect(isOwnerOnly({ mode: 0o40777 }, 'linux')).toBe(false)
    expect(isOwnerOnly({ mode: 0o40777 }, 'win32')).toBe(true)
  })
})
