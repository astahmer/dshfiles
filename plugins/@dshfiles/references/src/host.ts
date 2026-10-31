import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Context as EffectContext, Effect, Layer } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineApi, method, PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { defineCommand, defineHost, definePromptContext, type CommandInvocation, type CommandResult } from '@dshfiles/dshx/host'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { References, type Reference, type ReferenceStore } from './references.js'

const storageDomainOf = (ctx: Context) => ctx.get('storageDomain')
type StorageDomain = ReturnType<typeof storageDomainOf>

/** Resolved once the storage domain opened, so the prompt context can read attachments synchronously. */
let store: ReferenceStore | undefined
let hostStorage: StorageDomain
/** One store per Host process: API handlers receive other Cordis contexts, and a second store would clobber rows. */
let opening: Promise<ReferenceStore> | undefined

const storeOf = (storage: StorageDomain): Promise<ReferenceStore> => {
  if (opening !== undefined) return opening
  if (storage === undefined) {
    return Promise.reject(new PluginApiError('DSH storage is unavailable, so references cannot be kept; restart DSH and retry.', { code: 'storage-missing' }))
  }
  const started = storage.open(References.domain).then(domain => {
    const opened = References.store({ references: domain.table('references'), attachments: domain.table('attachments') })
    store = opened
    return opened
  })
  opening = started
  void started.catch(() => {
    if (opening === started) opening = undefined
  })
  return started
}

const clonesDirectory = (): string => join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'references')

const saveReference = async (
  input: {
    readonly name: string
    readonly source: string
    readonly ref?: string | undefined
    readonly description?: string | undefined
  },
  store: ReferenceStore,
): Promise<Reference> => {
  const reference = await References.prepare({ ...input, clonesDirectory: clonesDirectory() })
  await store.save(reference)
  return reference
}

const sessionOf = (input: { readonly sessionId?: string | undefined }, caller: ApiCaller): string => {
  const sessionId = input.sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
  if (sessionId === undefined)
    throw new PluginApiError('Pass the sessionId to attach to; only an agent call defaults to its own Session.', { code: 'no-session' })
  return sessionId
}

const describe = (reference: Reference): string =>
  `${reference.name} · ${reference.path}${reference.kind === 'git' ? ` (${reference.source}${reference.ref === null ? '' : ` @ ${reference.ref}`})` : ''}`

const sessionInput = z.string().min(1).max(256).optional().describe('Session to change; defaults to the calling agent’s own Session.')

const referencesApi = defineApi({
  id: 'references',
  version: 1,
  owner: '@dshfiles/references',
  methods: {
    list: method({
      input: z.object({ sessionId: sessionInput }).strict(),
      output: z.object({ references: z.array(References.referenceSchema), attached: z.array(References.nameSchema) }).strict(),
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
      input: z
        .object({
          name: References.nameSchema,
          source: z.string().min(1).max(2048).describe('Absolute directory path (or ~/…) or git URL.'),
          ref: z.string().min(1).max(256).optional().describe('Branch or tag to clone a git reference at.'),
          description: z.string().max(500).optional(),
        })
        .strict(),
      output: References.referenceSchema,
      description:
        'Save a named reference: an outside directory read in place, or a git URL shallow-cloned under $DSH_HOME/references. Saving an existing name replaces it (a git reference is cloned again). Call only when the user asked to add a reference.',
      tool: { name: 'reference_save', render: output => `Saved reference ${describe(output)}.` },
    }),
    remove: method({
      input: z.object({ name: References.nameSchema, confirm: z.literal(true) }).strict(),
      output: z.object({ removed: z.boolean() }).strict(),
      description:
        'Forget a saved reference and detach it from every Session; a git clone is deleted, a directory is left untouched. Requires confirm: true. Call only when the user asked to remove it.',
      tool: { name: 'reference_remove', render: output => (output.removed ? 'Removed that reference.' : 'No reference had that name.') },
    }),
    attach: method({
      input: z.object({ name: References.nameSchema, sessionId: sessionInput }).strict(),
      output: z.object({ attached: z.array(References.nameSchema) }).strict(),
      description:
        'Attach a saved reference to a Session, so its path and origin are part of that Session’s runtime context from the next model request. Call only when the user asked to attach it.',
      tool: { name: 'reference_attach', render: output => `Attached references: ${output.attached.join(', ')}.` },
    }),
    detach: method({
      input: z.object({ name: References.nameSchema, sessionId: sessionInput }).strict(),
      output: z.object({ attached: z.array(References.nameSchema) }).strict(),
      description: 'Detach a reference from a Session; the saved reference stays. Call only when the user asked to detach it.',
      tool: {
        name: 'reference_detach',
        render: output => (output.attached.length === 0 ? 'No references attached.' : `Attached references: ${output.attached.join(', ')}.`),
      },
    }),
  },
})

const storeForCommand = (): Promise<ReferenceStore> => storeOf(hostStorage)

const attachedNames = async (sessionId: string): Promise<string[]> => (await storeForCommand()).attached(sessionId).map(reference => reference.name)

interface ReferencesRuntimeShape {
  readonly store: Effect.Effect<ReferenceStore, unknown>
  readonly initialize: Effect.Effect<void>
}

class ReferencesRuntime extends EffectContext.Service<ReferencesRuntime, ReferencesRuntimeShape>()('dshfiles/references/Runtime') {}

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: (ctx: Context) => {
    hostStorage = storageDomainOf(ctx)
    const store = Effect.tryPromise({ try: () => storeOf(hostStorage), catch: error => error })
    return Layer.succeed(ReferencesRuntime, {
      store,
      initialize: store.pipe(
        Effect.catch(error => Effect.sync(() => ctx.logger.warn('references: %s', error instanceof Error ? error.message : String(error)))),
        Effect.asVoid,
      ),
    })
  },
  setup: () =>
    Effect.gen(function* () {
      const runtime = yield* ReferencesRuntime
      yield* runtime.initialize
    }),
})

const api = hostApi(referencesApi, {
  list: Effect.fn('references list')(({ input, caller }) =>
    Effect.gen(function* () {
      const runtime = yield* ReferencesRuntime
      const store = yield* runtime.store
      const sessionId = input.sessionId ?? (caller.kind === 'agent' ? caller.sessionId : undefined)
      return {
        references: store.list(),
        attached: sessionId === undefined ? [] : store.attached(sessionId).map(reference => reference.name),
      }
    }),
  ),
  save: Effect.fn('references save')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* ReferencesRuntime
      const store = yield* runtime.store
      return yield* Effect.tryPromise({ try: () => saveReference(input, store), catch: error => error })
    }),
  ),
  remove: Effect.fn('references remove')(({ input }) =>
    Effect.gen(function* () {
      const runtime = yield* ReferencesRuntime
      const store = yield* runtime.store
      const reference = store.get(input.name)
      if (reference?.kind === 'git') yield* Effect.tryPromise({ try: () => rm(reference.path, { recursive: true, force: true }), catch: error => error })
      return { removed: yield* Effect.tryPromise({ try: () => store.remove(input.name), catch: error => error }) }
    }),
  ),
  attach: Effect.fn('references attach')(({ input, caller }) =>
    Effect.gen(function* () {
      const sessionId = sessionOf(input, caller)
      const runtime = yield* ReferencesRuntime
      const store = yield* runtime.store
      if (store.get(input.name) === undefined) {
        return yield* Effect.fail(
          new PluginApiError(`No reference is named ${input.name}; save it first or list the saved ones.`, { code: 'unknown-reference' }),
        )
      }
      yield* Effect.tryPromise({ try: () => store.attach(sessionId, input.name), catch: error => error })
      return { attached: store.attached(sessionId).map(reference => reference.name) }
    }),
  ),
  detach: Effect.fn('references detach')(({ input, caller }) =>
    Effect.gen(function* () {
      const sessionId = sessionOf(input, caller)
      const runtime = yield* ReferencesRuntime
      const store = yield* runtime.store
      yield* Effect.tryPromise({ try: () => store.detach(sessionId, input.name), catch: error => error })
      return { attached: store.attached(sessionId).map(reference => reference.name) }
    }),
  ),
})

const USAGE = 'Usage: /reference · /reference attach <name> · /reference detach <name> · /reference save <name> <directory-or-git-url> [ref]'

const referenceCommand = defineCommand({
  name: 'reference',
  description: 'List, attach, detach or save named outside directories and git repositories for this thread.',
  input: { hint: 'attach <name> · detach <name> · save <name> <directory-or-git-url> [ref]' },
  handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
    const [verb, name, source, ref, ...rest] = invocation.rawInput
      .trim()
      .split(/\s+/u)
      .filter(part => part.length > 0)
    const sessionId = String(invocation.agent.id)
    try {
      if (verb === undefined) {
        const attached = await attachedNames(sessionId)
        const lines = (await storeForCommand()).list().map(reference => `${attached.includes(reference.name) ? '● ' : '○ '}${describe(reference)}`)
        return { kind: 'success', text: lines.length === 0 ? `No saved references. ${USAGE}` : lines.join('\n') }
      }
      const parsedName = References.nameSchema.safeParse(name)
      if (!parsedName.success) return { kind: 'error', text: USAGE }
      if (verb === 'attach' && source === undefined) {
        if ((await storeForCommand()).get(parsedName.data) === undefined) return { kind: 'error', text: `No reference is named ${parsedName.data}. ${USAGE}` }
        await (await storeForCommand()).attach(sessionId, parsedName.data)
        return { kind: 'success', text: `Attached ${parsedName.data}. Attached now: ${(await attachedNames(sessionId)).join(', ')}.` }
      }
      if (verb === 'detach' && source === undefined) {
        const detached = await (await storeForCommand()).detach(sessionId, parsedName.data)
        return detached
          ? { kind: 'success', text: `Detached ${parsedName.data}.` }
          : { kind: 'error', text: `${parsedName.data} is not attached to this thread.` }
      }
      if (verb === 'save' && source !== undefined && rest.length === 0) {
        const store = await storeForCommand()
        const reference = await saveReference({ name: parsedName.data, source, ref }, store)
        await store.attach(sessionId, reference.name)
        return { kind: 'success', text: `Saved and attached ${describe(reference)}.` }
      }
      return { kind: 'error', text: USAGE }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  },
})

const attachedContext = definePromptContext({
  name: 'dshfiles-references:attached',
  order: 200,
  interpolate: false,
  text: assembly => (store === undefined || assembly.agent === undefined ? '' : References.promptText(store.attached(String(assembly.agent.id)))),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/references',
  inject: ['storageDomain'],
  commands: [referenceCommand],
  prompts: [attachedContext],
  apis: [api],
})
