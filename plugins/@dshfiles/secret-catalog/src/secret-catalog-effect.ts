import { Effect } from 'effect'
import { SecretCliError } from './secret-cli-runner.js'
import { SecretCatalogOperationError } from './secret-operations.js'

type SecretCatalogFailure = SecretCliError | SecretCatalogOperationError

const toSecretCatalogFailure = (failure: unknown): SecretCatalogFailure => {
  if (failure instanceof SecretCliError || failure instanceof SecretCatalogOperationError) return failure
  throw failure
}

const trySecretCatalogOperation = <Value>(run: (signal: AbortSignal) => Promise<Value>) =>
  Effect.tryPromise({ try: signal => run(signal), catch: toSecretCatalogFailure })

export const secretCatalogQuery = Effect.fn('secret catalog query')(<Value>(run: (signal: AbortSignal) => Promise<Value>) => trySecretCatalogOperation(run))

export const secretCatalogChange = Effect.fn('secret catalog change')(<Value>(run: (signal: AbortSignal) => Promise<Value>) => trySecretCatalogOperation(run))
