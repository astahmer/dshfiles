import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import type { SecretMetadata } from './secret-metadata.js'
import { createSecretCatalogValues } from './secret-reference-resolver.js'
import { createSecretCatalogOperations, type SecretCatalogOperations, type SecretCliRequest } from './secret-operations.js'

const row = (overrides: Partial<SecretMetadata>): SecretMetadata => ({
  id: 'row',
  alias: 'TOKEN',
  scope: 'global',
  environment: 'prod',
  variableName: 'TOKEN',
  item: 'Item',
  field: 'password',
  service: 'example.test',
  description: '',
  ...overrides,
})

const valuesWith = (rows: readonly SecretMetadata[]) => {
  const calls: { alias: string; scope: string; cwd: string | null; environment: string | undefined }[] = []
  const operations: Pick<SecretCatalogOperations, 'list' | 'reveal'> = {
    list: async () => rows,
    reveal: async (alias, scope, cwd, environment) => {
      calls.push({ alias, scope, cwd, environment })
      return 'resolved-secret-value'
    },
  }
  return { values: createSecretCatalogValues({ operations }), calls }
}

describe('secret reference resolution', () => {
  it('resolves the matching row with its own scope and environment', async () => {
    const fixture = valuesWith([row({}), row({ alias: 'OTHER' })])
    const value = await fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null })
    expect(value).toBe('resolved-secret-value')
    expect(fixture.calls).toEqual([{ alias: 'TOKEN', scope: 'global', cwd: null, environment: 'prod' }])
  })

  it('passes one request signal to both list and reveal', async () => {
    const controller = new AbortController()
    const receivedSignals: (AbortSignal | undefined)[] = []
    const values = createSecretCatalogValues({
      operations: {
        list: async (_cwd, signal) => {
          receivedSignals.push(signal)
          return [row({})]
        },
        reveal: async (_alias, _scope, _cwd, _environment, signal) => {
          receivedSignals.push(signal)
          return 'resolved-secret-value'
        },
      },
    })

    await values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null, signal: controller.signal })

    expect(receivedSignals).toEqual([controller.signal, controller.signal])
  })

  it('aborts a value resolution when its list request is cancelled', async () => {
    const controller = new AbortController()
    const reason = new Error('reference request cancelled')
    let subprocessSignal: AbortSignal | undefined
    const operations = createSecretCatalogOperations(async (request: SecretCliRequest) => {
      subprocessSignal = request.signal
      const signal = request.signal
      if (signal === undefined) throw new Error('The CLI request omitted its signal.')
      return new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const values = createSecretCatalogValues({ operations })
    const pending = values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null, signal: controller.signal })

    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(subprocessSignal?.aborted).toBe(true)
  })

  it('resolves a project alias through the caller folder', async () => {
    const fixture = valuesWith([row({ scope: 'project', environment: 'dev' })])
    await fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'dev' }, cwd: '/tmp/project' })
    expect(fixture.calls).toEqual([{ alias: 'TOKEN', scope: 'project', cwd: '/tmp/project', environment: 'dev' }])
  })

  it('advertises exact-scope enforcement and reveals only the selected scope', async () => {
    const fixture = valuesWith([row({ scope: 'project' })])
    expect(fixture.values.supportsExpectedScope).toBe(true)
    await fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project', expectedScope: 'project' })
    expect(fixture.calls).toEqual([{ alias: 'TOKEN', scope: 'project', cwd: '/tmp/project', environment: 'prod' }])
  })

  it('rejects a scope replacement between metadata selection and resolution before reading any value', async () => {
    let rows = [row({ scope: 'project' })]
    let reveals = 0
    const values = createSecretCatalogValues({
      operations: {
        list: async () => rows,
        reveal: async () => {
          reveals += 1
          return 'fixture-value-not-to-be-read'
        },
      },
    })
    const selectedScope = rows[0]?.scope
    expect(selectedScope).toBe('project')
    rows = [row({ scope: 'global' })]
    await expect(values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project', expectedScope: 'project' })).rejects.toThrow(
      'scope changed',
    )
    expect(reveals).toBe(0)
  })

  it('names the alias and environment when nothing matches, without revealing', async () => {
    const fixture = valuesWith([row({ environment: 'prod' })])
    await expect(fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'dev' }, cwd: null })).rejects.toThrow(
      'No secret alias TOKEN is configured for environment dev.',
    )
    expect(fixture.calls).toEqual([])
  })

  it('refuses a duplicate alias rather than guessing its scope', async () => {
    const fixture = valuesWith([row({ scope: 'global' }), row({ scope: 'project' })])
    await expect(fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project' })).rejects.toThrow(
      'exists in several scopes',
    )
    expect(fixture.calls).toEqual([])
  })

  it('records a secret resolve span with the alias, environment and scope, never the value', async () => {
    using recorder = recordSpans()
    await valuesWith([row({ scope: 'project' })]).values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/private/tmp/project' })
    const span = recorder.span('secret resolve')
    expect(span.attributes).toEqual({ 'secret.alias': 'TOKEN', 'secret.environment': 'prod', 'secret.project_scoped': true, 'secret.scope': 'project' })
    expect(JSON.stringify(span.attributes)).not.toContain('resolved-secret-value')
  })
})
