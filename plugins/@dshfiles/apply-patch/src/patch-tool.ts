import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { applyEdits, describeEditsFailure, type PatchEdit } from './apply-edits.js'
import { PatchHost } from './patch-host-promise.js'

const editSchema = Schema.Struct({
  old: Schema.String.annotate({ description: 'Literal text to find.' }),
  new: Schema.String.annotate({ description: 'Replacement text.' }),
  replaceAll: Schema.optionalKey(Schema.Boolean.annotate({ description: 'Replace every match instead of requiring exactly one.' })),
})

const inputSchema = Schema.Struct({
  path: Schema.String.annotate({ description: 'File to edit; relative paths resolve against the Session working directory.' }).pipe(
    Schema.decodeTo(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  ),
  edits: Schema.Array(editSchema)
    .check(Schema.isMinLength(1), Schema.isMaxLength(50))
    .annotate({ description: 'Ordered replacements; identical old/new pairs are ignored, and each other anchor must match once unless replaceAll is set.' }),
})

const outputSchema = Schema.Struct({
  path: Schema.String,
  exact: Schema.Int,
  fuzzy: Schema.Int,
  bytes: Schema.Int,
  operation: Schema.String,
})

const refusals = ['policy-missing', 'session-gone', 'not-found', 'not-a-file', 'anchor'] as const

/** apply_patch refused before writing: the Host cannot enforce the policy, the caller left, or the anchors fail. */
class ApplyPatchRefused extends Schema.TaggedError<ApplyPatchRefused>()(
  'ApplyPatchRefused',
  { reason: Schema.Literals(refusals), path: Schema.String, detail: Schema.optional(Schema.String), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'apply-patch-refused' },
) {
  override get message(): string {
    if (this.reason === 'policy-missing') return 'apply_patch: the mounted filesystem confines but ctx.sandboxPolicy is missing'
    if (this.reason === 'session-gone') return 'cannot patch because the caller session is no longer live'
    if (this.reason === 'not-found') return `cannot patch "${this.path}": not found`
    if (this.reason === 'not-a-file') return `cannot patch "${this.path}": not a regular file`
    return `cannot patch "${this.path}": ${this.detail ?? 'the edits do not apply'}`
  }
}

const describeOutcome = (output: typeof outputSchema.Type): string =>
  `${output.operation} ${output.path} · ${String(output.exact)} exact + ${String(output.fuzzy)} whitespace-tolerant edit(s) · ${String(output.bytes)} bytes`

/**
 * Edits one file without the native read-before-edit handshake: it reads the
 * file itself, keeps that read as an observation, and writes exactly once. The
 * measured failure classes it targets are "file has not been read" (613 in one
 * week), "file changed since it was read" (302) and "old_string was not found"
 * (269): a single atomic write after its own read removes the first two, and the
 * whitespace-tolerant retry removes most of the third.
 *
 * PatchHost reads the filesystem services from the plugin's own context, never from the scoped Agent one: a scoped
 * Agent context only resolves services it declares as injected (`cannot get property … without inject`, 453
 * failures in one week).
 */
export const applyPatchTool = Tool.make({
  name: 'apply_patch',
  description:
    'Edit one existing text file atomically: reads it first, applies literal replacements in order, ignores identical old/new pairs, then writes once. Whitespace-tolerant fallback finds a reindented or rewrapped anchor; an ambiguous or missing anchor fails without writing and names the candidate lines. Use it after inspecting a file with ast-outline, bash or grep instead of `edit`. Read-only when it fails; it never creates a file.',
  input: inputSchema,
  output: outputSchema,
  render: describeOutcome,
  execute: Effect.fn('apply patch')(function* (input, call) {
    const host = yield* PatchHost
    if (host.confinesWithoutPolicy) return yield* new ApplyPatchRefused({ reason: 'policy-missing', path: input.path })
    const agent = call.agent
    const session = agent === undefined ? undefined : host.liveSession(agent)
    if (agent !== undefined && session === undefined) return yield* new ApplyPatchRefused({ reason: 'session-gone', path: input.path })
    const sandboxPolicy = host.sandboxPolicy(session)
    const cwd = agent === undefined ? undefined : yield* host.workingDirectory(agent)
    const target = yield* host.resolve({ path: input.path, cwd })
    const info = yield* host.stat(target)
    if (info === undefined) {
      yield* host.observed({ target, observation: { kind: 'absent' }, call })
      return yield* new ApplyPatchRefused({ reason: 'not-found', path: target.displayPath })
    }
    if (info.type !== 'file') return yield* new ApplyPatchRefused({ reason: 'not-a-file', path: target.displayPath })
    const before = yield* host.readText(target)
    yield* host.observed({ target, observation: { kind: 'present', version: info.version }, call })
    const edits: readonly PatchEdit[] = input.edits.map(edit =>
      edit.replaceAll === undefined ? { old: edit.old, new: edit.new } : { old: edit.old, new: edit.new, replaceAll: edit.replaceAll },
    )
    const result = applyEdits({ content: before, edits })
    if (!result.ok) return yield* new ApplyPatchRefused({ reason: 'anchor', path: target.displayPath, detail: describeEditsFailure(result.error) })
    const outcome = yield* host.writeText({ target, content: result.value.content, policy: sandboxPolicy })
    yield* host.observed({ target, observation: { kind: 'present', version: outcome.version }, call })
    return {
      path: host.processPath(target),
      exact: result.value.exact,
      fuzzy: result.value.fuzzy,
      bytes: Buffer.byteLength(result.value.content, 'utf8'),
      operation: outcome.operation,
    }
  }),
})
