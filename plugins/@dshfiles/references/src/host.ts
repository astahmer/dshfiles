import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { HostCommands } from '@dshfiles/dshx/effect/host-commands'
import { HostPrompt } from '@dshfiles/dshx/effect/host-prompt'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import type { CommandInvocation, CommandResult } from '@dshfiles/dshx/host'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer, Option, Schema } from 'effect'
import { referencesApi, ReferencesWire } from './api.js'
import { References, type ReferenceDraft } from './references.js'

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
    const lines = (yield* references.list).map(reference => `${attached.includes(reference.name) ? '● ' : '○ '}${ReferencesWire.describe(reference)}`)
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
    return success(`Saved and attached ${ReferencesWire.describe(reference)}.`)
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
