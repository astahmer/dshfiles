import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { secretCatalogChange, secretCatalogQuery } from './secret-catalog-effect.js'
import { SecretCliError } from './secret-cli-runner.js'
import { SecretCatalogOperationError } from './secret-operations.js'

describe('Secret Catalog Effect boundaries', () => {
  it('records query and change work spans through the dshx tracer bridge', async () => {
    using recorder = recordSpans()

    await Effect.runPromise(
      Effect.provide(
        secretCatalogQuery(async () => ({ listed: true })),
        DshxEffect.tracerLayer,
      ),
    )
    await Effect.runPromise(
      Effect.provide(
        secretCatalogChange(async () => ({ changed: true })),
        DshxEffect.tracerLayer,
      ),
    )

    expect(recorder.span('secret catalog query').name).toBe('secret catalog query')
    expect(recorder.span('secret catalog change').name).toBe('secret catalog change')
  })

  it('keeps expected tagged failures typed and unexpected rejections internal', async () => {
    const domainFailure = new SecretCatalogOperationError({ message: 'An alias with this name already exists.' })
    const cliFailure = new SecretCliError('cli-failed')
    const domainResult = await Effect.runPromise(
      Effect.provide(Effect.flip(secretCatalogChange(async () => Promise.reject(domainFailure))), DshxEffect.tracerLayer),
    )
    const cliResult = await Effect.runPromise(Effect.provide(Effect.flip(secretCatalogQuery(async () => Promise.reject(cliFailure))), DshxEffect.tracerLayer))
    const unexpectedFailure = new Error('unexpected failure')
    const unexpectedExit = await Effect.runPromiseExit(
      Effect.provide(
        secretCatalogQuery(async () => Promise.reject(unexpectedFailure)),
        DshxEffect.tracerLayer,
      ),
    )

    expect(domainResult).toBe(domainFailure)
    expect(cliResult).toBe(cliFailure)
    expect(Exit.isFailure(unexpectedExit)).toBe(true)
    if (Exit.isFailure(unexpectedExit)) expect(Cause.squash(unexpectedExit.cause)).toBe(unexpectedFailure)
  })
})
