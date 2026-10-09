import { describe, expect, it } from 'vitest'
import { parseSecretPrintMetadata } from './secret-metadata.js'
import { createSecretCatalogCredentialBridge } from './credential-bridge.js'
import { createSecretCatalogOperations, type SecretCliRequest } from './secret-operations.js'

const metadata = (alias = 'OPENCODE_GO_KEY', scope = 'global') =>
  parseSecretPrintMetadata(
    JSON.stringify([
      {
        alias,
        scope,
        env: 'prod',
        envKey: alias,
        item: 'opencode-go',
        field: 'password',
        service: 'OpenCode Go',
        value: 'synthetic-secret-must-not-cross',
      },
    ]),
    scope,
  )

const testOperations = (rows = metadata()) => {
  const requests: SecretCliRequest[] = []
  const operations = createSecretCatalogOperations(async request => {
    requests.push(request)
    if (request.args[0] === 'print') return JSON.stringify(rows)
    if (request.args[0] === 'get') return 'synthetic-secret-value\n'
    return ''
  })
  return { operations, requests }
}

describe('Secret Catalog credential bridge', () => {
  it('projects only unique, value-free metadata for supported scopes', async () => {
    const rows = [
      ...metadata(),
      ...metadata('PROJECT_KEY', 'project'),
      ...metadata('LOCAL_KEY', 'local'),
      ...metadata('UNKNOWN_SCOPE', 'unknown'),
      ...metadata('DUPLICATE_KEY', 'project'),
      ...metadata('DUPLICATE_KEY', 'project'),
    ]
    const { operations } = testOperations(rows)
    const bridge = createSecretCatalogCredentialBridge({ operations, getCredentials: () => undefined })

    const options = await bridge.listKeys('/tmp/project')

    expect(options).toEqual([
      { alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, variableName: 'OPENCODE_GO_KEY', service: 'OpenCode Go', description: 'OpenCode Go' },
      { alias: 'PROJECT_KEY', environment: 'prod', scope: 'project', cwd: '/tmp/project', variableName: 'PROJECT_KEY', service: 'OpenCode Go', description: 'OpenCode Go' },
      { alias: 'LOCAL_KEY', environment: 'prod', scope: 'local', cwd: '/tmp/project', variableName: 'LOCAL_KEY', service: 'OpenCode Go', description: 'OpenCode Go' },
    ])
    expect(JSON.stringify(options)).not.toContain('synthetic-secret')
  })

  it('stores a selected secret in the write-only credential provider', async () => {
    const { operations, requests } = testOperations()
    const writes: Array<{ readonly ref: string; readonly value: string }> = []
    const credentials = {
      describe: async () => ({ configured: false, writable: true }),
      set: async (ref: string, value: string) => {
        writes.push({ ref, value })
      },
    }
    const bridge = createSecretCatalogCredentialBridge({ operations, getCredentials: () => credentials })

    const result = await bridge.importKey({ alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY' })

    expect(result).toBeUndefined()
    expect(writes).toEqual([{ ref: 'OPENCODEX_OPENCODE_GO_API_KEY', value: 'synthetic-secret-value' }])
    expect(requests.filter(request => request.args[0] === 'get')).toEqual([
      {
        args: ['get', 'OPENCODE_GO_KEY', '--env', 'prod', '--config', expect.any(String)],
        cwd: null,
        captureStdout: true,
      },
    ])
  })

  it('imports a project-scoped key only from the explicitly selected folder', async () => {
    const { operations, requests } = testOperations(metadata('PROJECT_KEY', 'project'))
    const writes: Array<{ readonly ref: string; readonly value: string }> = []
    const credentials = {
      describe: async () => ({ configured: false, writable: true }),
      set: async (ref: string, value: string) => {
        writes.push({ ref, value })
      },
    }
    const bridge = createSecretCatalogCredentialBridge({ operations, getCredentials: () => credentials })

    await bridge.importKey({
      alias: 'PROJECT_KEY',
      environment: 'prod',
      scope: 'project',
      cwd: '/tmp/project',
      targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY',
    })

    expect(writes).toEqual([{ ref: 'OPENCODEX_OPENCODE_GO_API_KEY', value: 'synthetic-secret-value' }])
    expect(requests.find(request => request.args[0] === 'get')?.cwd).toBe('/tmp/project')
    expect(JSON.stringify(requests.filter(request => request.args[0] !== 'get'))).not.toContain('synthetic-secret')
  })

  it('refuses invalid target refs and ambiguous catalog entries before revealing a value', async () => {
    const duplicateRows = [...metadata(), ...metadata()]
    const { operations, requests } = testOperations(duplicateRows)
    const bridge = createSecretCatalogCredentialBridge({
      operations,
      getCredentials: () => ({
        describe: async () => ({ configured: false, writable: true }),
        set: async () => undefined,
      }),
    })

    await expect(bridge.importKey({ alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, targetRef: 'PATH' })).rejects.toThrow(
      'Choose an API-key variable ending in _API_KEY.',
    )
    await expect(
      bridge.importKey({ alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY' }),
    ).rejects.toThrow('That Secret Catalog entry is unavailable or ambiguous.')
    expect(requests.every(request => request.args[0] !== 'get')).toBe(true)
  })

  it('does not reveal the source when the destination is shadowed by a read-only source', async () => {
    const { operations, requests } = testOperations()
    const bridge = createSecretCatalogCredentialBridge({
      operations,
      getCredentials: () => ({
        describe: async () => ({ configured: true, source: 'env', writable: false }),
        set: async () => undefined,
      }),
    })

    await expect(
      bridge.importKey({ alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY' }),
    ).rejects.toThrow('That variable is supplied by a read-only source; choose another API-key variable.')
    expect(requests.every(request => request.args[0] !== 'get')).toBe(true)
  })

  it('does not overwrite an already configured writable destination', async () => {
    const { operations, requests } = testOperations()
    const bridge = createSecretCatalogCredentialBridge({
      operations,
      getCredentials: () => ({
        describe: async () => ({ configured: true, writable: true }),
        set: async () => undefined,
      }),
    })

    await expect(
      bridge.importKey({ alias: 'OPENCODE_GO_KEY', environment: 'prod', scope: 'global', cwd: null, targetRef: 'OPENCODEX_OPENCODE_GO_API_KEY' }),
    ).rejects.toThrow('That API-key variable already has a value; choose another reference.')
    expect(requests.every(request => request.args[0] !== 'get')).toBe(true)
  })
})
