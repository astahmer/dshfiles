import { discoverBaselineInstructionFiles } from '@deepseek-ai/dsh-agent-instructions'
import { Context, Effect, FileSystem, Layer, Option, Schema } from 'effect'

import type { InstructionFile } from './api.js'

/** DSH's instruction discovery rejected the folder (no such folder, a probe failed). */
export class InstructionDiscoveryFailed extends Schema.TaggedError<InstructionDiscoveryFailed>()(
  'InstructionDiscoveryFailed',
  { cwd: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'instruction-discovery-failed' },
) {
  override get message(): string {
    return `Workspace instructions for ${this.cwd} could not be listed. Check that the folder exists, then open the Context tab again.`
  }
}

/**
 * The instruction files a thread folder loads, found by DSH's own loader (`@deepseek-ai/dsh-agent-instructions`) so the
 * Context facet lists what the model gets, not a guess. A profile row that changes the candidate names is not read: the
 * facet says it uses the default discovery settings.
 */
export class InstructionFiles extends Context.Service<
  InstructionFiles,
  { readonly list: (cwd: string) => Effect.Effect<readonly InstructionFile[], InstructionDiscoveryFailed> }
>()('@dshfiles/agent-toolkit/InstructionFiles') {
  static readonly layer = Layer.effect(
    InstructionFiles,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const list = Effect.fn('instruction files discover')(function* (cwd: string) {
        const found = yield* Effect.tryPromise({
          try: signal => discoverBaselineInstructionFiles({ cwd, signal }),
          catch: cause => new InstructionDiscoveryFailed({ cwd, cause }),
        })
        yield* Effect.annotateCurrentSpan({ 'agent_toolkit.instruction_files': found.length })
        return yield* Effect.forEach(
          found,
          file =>
            fs.stat(file.absolutePath).pipe(
              Effect.option,
              Effect.map(info => ({
                path: file.displayPath,
                absolutePath: file.absolutePath,
                bytes: Option.match(info, { onNone: () => null, onSome: stat => Number(stat.size) }),
              })),
            ),
          { concurrency: 8 },
        )
      })
      return InstructionFiles.of({ list })
    }),
  )
}
