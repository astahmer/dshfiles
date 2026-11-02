import { Effect, Layer } from 'effect'
import { SecretCatalog } from './secret-catalog.js'
import { SecretCli, type SecretCliError, type SecretCliRequest } from './secret-cli.js'

/** The real Secret Catalog over a stand-in CLI that records every request it answers. */
export const catalogWithCli = (answer: (request: SecretCliRequest) => Effect.Effect<string, SecretCliError>) => {
  const requests: SecretCliRequest[] = []
  const layer = SecretCatalog.layer.pipe(
    Layer.provide(
      SecretCli.layerTest(request =>
        Effect.suspend(() => {
          requests.push(request)
          return answer(request)
        }),
      ),
    ),
  )
  return { requests, layer }
}

/** A stand-in CLI that prints `rows` for every `print` and answers `get` with `value`. */
export const catalogWithRows = (input: { readonly rows: readonly Record<string, string>[]; readonly value?: string }) =>
  catalogWithCli(request => {
    if (request.args[0] === 'print') return Effect.succeed(JSON.stringify(input.rows))
    if (request.args[0] === 'get') return Effect.succeed(input.value ?? 'synthetic-secret-value\n')
    return Effect.succeed('')
  })
