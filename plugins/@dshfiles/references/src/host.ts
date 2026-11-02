import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineApi, method, type ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostCommands } from '@dshfiles/dshx/effect/host-commands'
import { HostPrompt } from '@dshfiles/dshx/effect/host-prompt'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import type { CommandInvocation, CommandResult } from '@dshfiles/dshx/host'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer, Option, Schema } from 'effect'
import { References, type Reference, type ReferenceDraft } from './references.js'

class NoSession extends Schema.TaggedError<NoSession>()('NoSession', { cause: Schema.optional(Schema.Defect()) }, { dshxWireCode: 'no-session' }) {
  override get message(): string {
    return 'Pass the sessionId to attach to; only an agent call defaults to its own Session.'
  }
}

const callerSession = (input: { readonly sessionId?: string | undefined }, caller: ApiCaller): string | undefined =>
  input.sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)

const sessionOf = (input: { readonly sessionId?: string | undefined }, caller: ApiCaller) => {
  const sessionId = callerSession(input, caller)
  return sessionId === undefined ? Effect.fail(new NoSession({})) : Effect.succeed(sessionId)
}

const describe = (reference: Reference): string =>
  `${reference.name} · ${reference.path}${reference.kind === 'git' ? ` (${reference.source}${reference.ref === null ? '' : ` @ ${reference.ref}`})` : ''}`

const sessionInput = Schema.optional(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
    description: 'Session to change; defaults to the calling agent’s own Session.',
  }),
)

const referencesApi = defineApi({
  id: 'references',
  version: 1,
  owner: '@dshfiles/references',
  methods: {
    list: method({
      input: Schema.Struct({ sessionId: sessionInput }),
      output: Schema.Struct({ references: Schema.Array(References.referenceSchema), attached: Schema.Array(References.nameSchema) }),
      description: 'List saved references (named outside directories and git clones) and which are attached to a Session. Read-only.',
      tool: {
        name: 'references_list',
        readOnly: true,
        render: output =>
          output.references.map(reference => `${output.attached.includes(reference.name) ? '[attached] ' : ''}${describe(reference)}`).join('\n') ||
          'No saved references.',
      },
    }),
    save: method({
      input: Schema.Struct({
        name: References.nameSchema,
        source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({ description: 'Absolute directory path (or ~/…) or git URL.' }),
        ref: Schema.optional(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Branch or tag to clone a git reference at.' }),
        ),
        description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
      }),
      output: References.referenceSchema,
      description:
        'Save a named reference: an outside directory read in place, or a git URL shallow-cloned under $DSH_HOME/references. Saving an existing name replaces it (a git reference is cloned again). Call only when the user asked to add a reference.',
      tool: { name: 'reference_save', render: output => `Saved reference ${describe(output)}.` },
    }),
    remove: method({
      input: Schema.Struct({ name: References.nameSchema, confirm: Schema.Literal(true) }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description:
        'Forget a saved reference and detach it from every Session; a git clone is deleted, a directory is left untouched. Requires confirm: true. Call only when the user asked to remove it.',
      tool: { name: 'reference_remove', render: output => (output.removed ? 'Removed that reference.' : 'No reference had that name.') },
    }),
    attach: method({
      input: Schema.Struct({ name: References.nameSchema, sessionId: sessionInput }),
      output: Schema.Struct({ attached: Schema.Array(References.nameSchema) }),
      description:
        'Attach a saved reference to a Session, so its path and origin are part of that Session’s runtime context from the next model request. Call only when the user asked to attach it.',
      tool: { name: 'reference_attach', render: output => `Attached references: ${output.attached.join(', ')}.` },
    }),
    detach: method({
      input: Schema.Struct({ name: References.nameSchema, sessionId: sessionInput }),
      output: Schema.Struct({ attached: Schema.Array(References.nameSchema) }),
      description: 'Detach a reference from a Session; the saved reference stays. Call only when the user asked to detach it.',
      tool: {
        name: 'reference_detach',
        render: output => (output.attached.length === 0 ? 'No references attached.' : `Attached references: ${output.attached.join(', ')}.`),
      },
    }),
  },
})

const attachedNames = (sessionId: string) =>
  References.use(references => Effect.map(references.attached(sessionId), attached => attached.map(entry => entry.name)))

const USAGE = 'Usage: /reference · /reference attach <name> · /reference detach <name> · /reference save <name> <directory-or-git-url> [ref]'

const runCommand = Effect.fn('references command')(function* (invocation: CommandInvocation) {
  const references = yield* References
  const [verb, name, source, ref, ...rest] = invocation.rawInput
    .trim()
    .split(/\s+/u)
    .filter(part => part.length > 0)
  const sessionId = String(invocation.agent.id)
  const success = (text: string): CommandResult => ({ kind: 'success', text })
  const failure = (text: string): CommandResult => ({ kind: 'error', text })
  if (verb === undefined) {
    const attached = yield* attachedNames(sessionId)
    const lines = (yield* references.list).map(reference => `${attached.includes(reference.name) ? '● ' : '○ '}${describe(reference)}`)
    return success(lines.length === 0 ? `No saved references. ${USAGE}` : lines.join('\n'))
  }
  const parsedName = Schema.decodeUnknownOption(References.nameSchema)(name)
  if (Option.isNone(parsedName)) return failure(USAGE)
  if (verb === 'attach' && source === undefined) {
    const attached = yield* references.attach(sessionId, parsedName.value).pipe(Effect.option)
    if (Option.isNone(attached)) return failure(`No reference is named ${parsedName.value}. ${USAGE}`)
    return success(`Attached ${parsedName.value}. Attached now: ${(yield* attachedNames(sessionId)).join(', ')}.`)
  }
  if (verb === 'detach' && source === undefined) {
    return (yield* references.detach(sessionId, parsedName.value))
      ? success(`Detached ${parsedName.value}.`)
      : failure(`${parsedName.value} is not attached to this thread.`)
  }
  if (verb === 'save' && source !== undefined && rest.length === 0) {
    const draft: ReferenceDraft = { name: parsedName.value, source, ref }
    const reference = yield* references.save(draft)
    yield* references.attach(sessionId, reference.name)
    return success(`Saved and attached ${describe(reference)}.`)
  }
  return failure(USAGE)
})

/** `/reference` answers every failure as text. */
const referenceCommand = Layer.effectDiscard(
  HostCommands.register({
    name: 'reference',
    description: 'List, attach, detach or save named outside directories and git repositories for this thread.',
    input: { hint: 'attach <name> · detach <name> · save <name> <directory-or-git-url> [ref]' },
    handler: invocation => runCommand(invocation).pipe(Effect.catch(error => Effect.succeed<CommandResult>({ kind: 'error', text: error.message }))),
  }),
)

/** The attached references' paths and origins in every model request of the Session. */
const attachedContext = Layer.effectDiscard(
  Effect.gen(function* () {
    const references = yield* References
    yield* HostPrompt.context({
      name: 'dshfiles-references:attached',
      order: 200,
      interpolate: false,
      text: assembly => Effect.sync(() => (assembly.agent === undefined ? '' : References.promptText(references.attachedNow(String(assembly.agent.id))))),
    })
  }),
)

const library = References.layer.pipe(Layer.provide(Layer.mergeAll(StorageDomain.layer, DshChildProcessSpawner.layer, nodeFileSystemLayer, nodePathLayer)))

export default DshxPlugin.make({
  name: '@dshfiles/references',
  inject: ['storageDomain', 'subprocess', 'commands', 'systemPrompt'],
  layer: Layer.mergeAll(referenceCommand, attachedContext).pipe(Layer.provideMerge(library)),
  apis: [
    Api.bind(referencesApi, {
      list: (input, call) =>
        Effect.gen(function* () {
          const references = yield* References
          const sessionId = callerSession(input, call.caller)
          return { references: yield* references.list, attached: sessionId === undefined ? [] : yield* attachedNames(sessionId) }
        }),
      save: input => References.use(references => references.save(input)),
      remove: input => References.use(references => Effect.map(references.remove(input.name), removed => ({ removed }))),
      attach: (input, call) =>
        Effect.gen(function* () {
          const sessionId = yield* sessionOf(input, call.caller)
          yield* References.use(references => references.attach(sessionId, input.name))
          return { attached: yield* attachedNames(sessionId) }
        }),
      detach: (input, call) =>
        Effect.gen(function* () {
          const sessionId = yield* sessionOf(input, call.caller)
          yield* References.use(references => references.detach(sessionId, input.name))
          return { attached: yield* attachedNames(sessionId) }
        }),
    }),
  ],
})
