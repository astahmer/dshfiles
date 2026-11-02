import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineTool } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { applyEdits, describeEditsFailure, type PatchEdit } from './apply-edits.js'

const editSchema = Schema.Struct({
  old: Schema.String,
  new: Schema.String,
  replaceAll: Schema.optionalKey(Schema.Boolean),
})

const inputSchema = Schema.Struct({
  path: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  edits: Schema.Array(editSchema).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
})

const patchOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    exact: { type: 'integer', required: true },
    fuzzy: { type: 'integer', required: true },
    bytes: { type: 'integer', required: true },
    operation: { type: 'string', required: true },
  },
} as const

const describe = (output: {
  readonly path: string
  readonly exact: number
  readonly fuzzy: number
  readonly bytes: number
  readonly operation: string
}): string =>
  `${output.operation} ${output.path} · ${String(output.exact)} exact + ${String(output.fuzzy)} whitespace-tolerant edit(s) · ${String(output.bytes)} bytes`

class ApplyPatchFailure extends Schema.TaggedError<ApplyPatchFailure>()('ApplyPatchFailure', {
  message: Schema.String,
}) {}

const patchFailureSources = new WeakMap<ApplyPatchFailure, unknown>()

interface ApplyPatchHostServices {
  readonly context: Context
  readonly fs: Context['fs']
  readonly sandboxPolicy: Context['sandboxPolicy'] | undefined
  readonly sessions: Context['sessions']
  readonly workingDirectory: Context['workingDirectory']
}

export class ApplyPatchHost extends EffectContext.Service<ApplyPatchHost, ApplyPatchHostServices>()('@dshfiles/apply-patch/Host') {}

export const applyPatchRootLayer = (ctx: Context) =>
  Layer.succeed(ApplyPatchHost, {
    context: ctx,
    fs: ctx.fs,
    sandboxPolicy: ctx.get('sandboxPolicy'),
    sessions: ctx.sessions,
    workingDirectory: ctx.workingDirectory,
  })

const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const patchFailure = (error: unknown): ApplyPatchFailure => {
  const failure = new ApplyPatchFailure({ message: failureMessage(error) })
  patchFailureSources.set(failure, error)
  return failure
}

/**
 * Edits one file without the native read-before-edit handshake: it reads the
 * file itself, keeps that read as an observation, and writes exactly once. The
 * measured failure classes it targets are "file has not been read" (613 in one
 * week), "file changed since it was read" (302) and "old_string was not found"
 * (269): a single atomic write after its own read removes the first two, and the
 * whitespace-tolerant retry removes most of the third.
 *
 * Built from the plugin's own context, never from the scoped Agent one: a scoped
 * Agent context only resolves services it declares as injected, so reading the
 * filesystem services there throws `cannot get property … without inject` (453
 * failures in one week). `apply-patch` declares those services itself, and the
 * tool body must read them from the context that declared them.
 */
export const createApplyPatchTool = (services: ApplyPatchHostServices) =>
  defineTool({
    name: 'apply_patch',
    description:
      'Edit one existing text file atomically: reads it first, applies literal replacements in order, ignores identical old/new pairs, then writes once. Whitespace-tolerant fallback finds a reindented or rewrapped anchor; an ambiguous or missing anchor fails without writing and names the candidate lines. Use it after inspecting a file with ast-outline, bash or grep instead of `edit`. Read-only when it fails; it never creates a file.',
    parameters: {
      path: { type: 'string', required: true, description: 'File to edit; relative paths resolve against the Session working directory.' },
      edits: {
        type: 'array',
        required: true,
        description: 'Ordered replacements; identical old/new pairs are ignored, and each other anchor must match once unless replaceAll is set.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            old: { type: 'string', required: true, description: 'Literal text to find.' },
            new: { type: 'string', required: true, description: 'Replacement text.' },
            replaceAll: { type: 'boolean', description: 'Replace every match instead of requiring exactly one.' },
          },
        },
      },
    },
    output: {
      schema: patchOutputSchema,
      render(_args, value) {
        return [{ type: 'text', text: describe(value) }]
      },
    },
    execute: (args, execution) =>
      Effect.runPromise(
        Effect.provide(
          Effect.fn('apply patch')(function* () {
            const input = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(inputSchema, { onExcessProperty: 'error' })(args),
              catch: patchFailure,
            })
            const agent = execution.agent
            const policy = services.sandboxPolicy
            if (services.fs.sandboxMode !== undefined && policy === undefined) {
              return yield* new ApplyPatchFailure({ message: 'apply_patch: the mounted filesystem confines but ctx.sandboxPolicy is missing' })
            }
            const session = agent === undefined ? undefined : services.sessions.get(agent.id)
            if (agent !== undefined && session === undefined) {
              return yield* new ApplyPatchFailure({ message: 'cannot patch because the caller session is no longer live' })
            }
            const sandboxPolicy = policy?.resolve(session === undefined ? {} : { session })
            const cwd =
              agent === undefined
                ? undefined
                : yield* Effect.tryPromise({
                    try: signal => services.workingDirectory.ensure(agent, signal),
                    catch: patchFailure,
                  })
            const resolveOptions: { readonly cwd?: string; readonly signal: AbortSignal } =
              cwd === undefined ? { signal: execution.signal } : { cwd, signal: execution.signal }
            const target = yield* Effect.tryPromise({
              try: signal => services.fs.resolve(input.path, { ...resolveOptions, signal }),
              catch: patchFailure,
            })
            const info = yield* Effect.tryPromise({
              try: signal => services.fs.stat(target, signal),
              catch: patchFailure,
            })
            if (info === undefined) {
              services.context.emit('fs/observed', target, { kind: 'absent' }, execution)
              return yield* new ApplyPatchFailure({ message: `cannot patch "${target.displayPath}": not found` })
            }
            if (info.type !== 'file') {
              return yield* new ApplyPatchFailure({ message: `cannot patch "${target.displayPath}": not a regular file` })
            }
            const before = yield* Effect.tryPromise({
              try: signal => services.fs.readText(target, signal),
              catch: patchFailure,
            })
            services.context.emit('fs/observed', target, { kind: 'present', version: info.version }, execution)
            const edits: readonly PatchEdit[] = input.edits.map(edit =>
              edit.replaceAll === undefined ? { old: edit.old, new: edit.new } : { old: edit.old, new: edit.new, replaceAll: edit.replaceAll },
            )
            const result = applyEdits({ content: before, edits })
            if (!result.ok) {
              return yield* new ApplyPatchFailure({ message: `cannot patch "${target.displayPath}": ${describeEditsFailure(result.error)}` })
            }
            const outcome = yield* Effect.tryPromise({
              try: signal => services.fs.writeText(target, result.value.content, undefined, signal, sandboxPolicy),
              catch: patchFailure,
            })
            services.context.emit('fs/observed', target, { kind: 'present', version: outcome.version }, execution)
            return {
              path: services.fs.processPath(target),
              exact: result.value.exact,
              fuzzy: result.value.fuzzy,
              bytes: Buffer.byteLength(result.value.content, 'utf8'),
              operation: outcome.operation,
            }
          })().pipe(
            Effect.catchTag('ApplyPatchFailure', failure => {
              const original = patchFailureSources.get(failure)
              return original instanceof Error ? Effect.fail(original) : Effect.fail(failure)
            }),
          ),
          DshxEffect.tracerLayer,
        ),
        { signal: execution.signal },
      ),
  })
