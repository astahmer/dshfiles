import { Effect, Layer } from 'effect'
import { makeFilesProvider } from './provider-files.js'
import { makeGithubProvider } from './provider-github.js'
import { makeLinearProvider } from './provider-linear.js'
import { BacklogProviderRegistry } from './provider-registry.js'

/** The registry with the providers the backlog ships: Linear, GitHub Issues and markdown files, in that order. */
export const builtInProviderRegistry = Layer.unwrap(
  Effect.gen(function* () {
    const builtIns = [yield* makeLinearProvider(), yield* makeGithubProvider(), yield* makeFilesProvider()]
    return BacklogProviderRegistry.make(builtIns)
  }),
)
