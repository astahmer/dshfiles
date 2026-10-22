import { describe, expect, it } from 'vitest'
import type { SecretCliRequest } from './secret-operations.js'
import { createSecretCatalogOperations } from './secret-operations.js'
import { bindStoredSecret, storeAndBindSecret } from './secret-setup-flow.js'
import { SecretSetupModel } from './secret-setup-model.js'

const setupRequest = (input: {
  readonly alias: string
  readonly environment: string
  readonly scope: 'global' | 'project' | 'local'
  readonly cwd: string | null
  readonly value: string
}) =>
  SecretSetupModel.createInput({
    cwd: input.cwd,
    draft: {
      ...SecretSetupModel.draftDefaults({ suggestedAlias: input.alias, environment: input.environment, scope: input.scope }),
      value: input.value,
    },
  })

describe('Secret Catalog create-and-bind flow', () => {
  it('stores a synthetic project secret through the real CLI operation and binds only its reference', async () => {
    const requests: SecretCliRequest[] = []
    const operations = createSecretCatalogOperations(async request => {
      requests.push(request)
      return request.args[0] === 'print' ? '[]' : ''
    })
    const references: string[] = []
    const request = setupRequest({
      alias: 'SYNTHETIC_TOKEN',
      environment: 'staging',
      scope: 'project',
      cwd: '/tmp/synthetic-project',
      value: 'synthetic-setup-value',
    })

    const result = await storeAndBindSecret({
      request,
      ports: {
        create: input => operations.create(input),
        bind: async reference => {
          references.push(reference)
        },
      },
    })

    expect(result).toEqual({ status: 'bound', reference: 'secret:SYNTHETIC_TOKEN@staging' })
    expect(references).toEqual(['secret:SYNTHETIC_TOKEN@staging'])
    expect(requests).toEqual([
      { args: ['print', '--all', '--json'], cwd: '/tmp/synthetic-project', captureStdout: true },
      {
        args: ['set', 'SYNTHETIC_TOKEN', '--env', 'staging'],
        cwd: '/tmp/synthetic-project',
        captureStdout: false,
        stdin: 'synthetic-setup-value',
      },
    ])
    expect(JSON.stringify(result)).not.toContain('synthetic-setup-value')
    expect(JSON.stringify(references)).not.toContain('synthetic-setup-value')
    expect(requests.flatMap(request => request.args)).not.toContain('synthetic-setup-value')
  })

  it('keeps a stored reference for retry when binding fails, without creating a second secret', async () => {
    const requests: SecretCliRequest[] = []
    const operations = createSecretCatalogOperations(async request => {
      requests.push(request)
      return request.args[0] === 'print' ? '[]' : ''
    })
    const request = setupRequest({
      alias: 'SYNTHETIC_RETRY',
      environment: 'prod',
      scope: 'global',
      cwd: null,
      value: 'synthetic-retry-value',
    })
    let bindAttempts = 0
    const stored = await storeAndBindSecret({
      request,
      ports: {
        create: input => operations.create(input),
        bind: async () => {
          bindAttempts += 1
          throw new Error('synthetic binding failure')
        },
      },
    })
    const references: string[] = []
    const rebound = await bindStoredSecret({
      reference: stored.reference,
      bind: async reference => {
        references.push(reference)
      },
    })

    expect(stored).toEqual({ status: 'stored', reference: 'secret:SYNTHETIC_RETRY' })
    expect(rebound).toBe(true)
    expect(bindAttempts).toBe(1)
    expect(references).toEqual(['secret:SYNTHETIC_RETRY'])
    expect(requests.filter(request => request.args[0] === 'set')).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain('synthetic-retry-value')
  })

  it('refuses a duplicate in the Host operation and never binds it', async () => {
    const requests: SecretCliRequest[] = []
    const operations = createSecretCatalogOperations(async request => {
      requests.push(request)
      return request.args[0] === 'print' ? JSON.stringify([{ alias: 'SYNTHETIC_DUPLICATE', scope: 'global', env: 'prod' }]) : ''
    })
    let bindAttempts = 0
    const request = setupRequest({
      alias: 'SYNTHETIC_DUPLICATE',
      environment: 'prod',
      scope: 'global',
      cwd: null,
      value: 'synthetic-duplicate-value',
    })

    await expect(
      storeAndBindSecret({
        request,
        ports: {
          create: input => operations.create(input),
          bind: async () => {
            bindAttempts += 1
          },
        },
      }),
    ).rejects.toThrow()

    expect(bindAttempts).toBe(0)
    expect(requests.map(request => request.args[0])).toEqual(['print'])
  })
})
