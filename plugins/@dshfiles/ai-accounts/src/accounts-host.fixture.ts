import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { LlmRuntime, ReasoningEffortId, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { createTestHost, type MountedPlugin, type TestHost } from '@dshfiles/dshx/testing'
import { threadModelPolicySchema, type ThreadModelPolicy } from '@dshfiles/session-controller/thread-model-api'
import * as Schema from 'effect/Schema'

/**
 * The whole ai-accounts Host on a real Cordis Host: the native agent loop, session store, LLM runtime, storage and
 * local credentials. Only the outside world is fake: a loopback Command Code server whose bearer key names the account
 * a request actually went out on, and the native session controller, which records the selections it is asked for.
 *
 * Account paths are fixed when the store module loads, so this module claims `DSH_HOME` before importing the Host.
 */
// Real path: Codex login refuses a home with a symlinked ancestor such as macOS `/var`.
const home = realpathSync(mkdtempSync(join(tmpdir(), 'ai-accounts-host-')))
process.env.DSH_HOME = home

const MODEL = 'gpt-6-luna'

type ChatReply = { readonly text: string } | { readonly status: number; readonly message: string; readonly headers?: Readonly<Record<string, string>> }

const chatBodySchema = Schema.Struct({ reasoning_effort: Schema.optional(Schema.String) })

interface ChatRequest {
  /** The account whose key authorized the request. */
  readonly account: string
  readonly reasoningEffort: string | undefined
}

interface FixtureAccount {
  readonly id: string
  readonly enabled?: boolean
}

/** A generated private Codex account whose home this Host owns, as connection setup creates one. */
const managedCodexHome = (instanceId: string): string => join(home, 'plugins', 'ai-accounts', 'homes', instanceId)

const codexDraft = (instanceId: string) => ({
  ...draft({ id: instanceId }, ''),
  kind: 'codex',
  apiKeyEnv: '',
  homePath: managedCodexHome(instanceId),
  shadowHomePath: managedCodexHome(instanceId),
})

interface SelectionRequest {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

const apiEnvelopeSchema = <Output extends Schema.Top & { readonly DecodingServices: never }>(output: Output) =>
  Schema.Struct({
    result: Schema.Union([
      Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ version: Schema.Number, output }) }),
      Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
    ]),
  })

const keyEnvFor = (id: string): string => `${id.toUpperCase()}_API_KEY`
const keyFor = (id: string): string => `key-${id}`

const draft = (account: FixtureAccount, baseUrl: string) => ({
  instanceId: account.id,
  kind: 'commandcode',
  displayName: `Account ${account.id}`,
  enabled: account.enabled ?? true,
  homePath: '',
  shadowHomePath: '',
  apiKeyEnv: keyEnvFor(account.id),
  apiBaseUrl: baseUrl,
  badge: '',
  accentColor: '',
  providerIcon: '',
  additionalModelIds: [],
  reasoningDefaults: {},
  hiddenModelIds: [],
  favoriteModelIds: [],
  modelOrder: [],
})

const readText = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

const sseChunk = (delta: { readonly role?: 'assistant'; readonly content?: string }, finishReason: 'stop' | null = null): string =>
  `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`

const reply = (response: ServerResponse, scripted: ChatReply): void => {
  if ('text' in scripted) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(sseChunk({ role: 'assistant', content: scripted.text }) + sseChunk({}, 'stop') + 'data: [DONE]\n\n')
    return
  }
  response.writeHead(scripted.status, { 'content-type': 'application/json', ...scripted.headers })
  response.end(JSON.stringify({ error: { message: scripted.message, type: 'fixture_error' } }))
}

async function* withProviderRetryAfter(chunks: AsyncIterable<StreamChunk>, retryAfterMs: number): AsyncIterable<StreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      yield { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, providerRetryAfterMs: retryAfterMs } } }
      continue
    }
    yield chunk
  }
}

/** Every native selection counts as the user's own pick, the way the session controller annotates one. */
const userSelectionProjection = {
  key: 'threadModelPolicy' as const,
  stateSchema: threadModelPolicySchema,
  stateVersion: 1,
  init: (): ThreadModelPolicy => ({ revision: 0, selection: null, preferSelectedProvider: false }),
  apply: (state: ThreadModelPolicy, event: SessionEvent): ThreadModelPolicy =>
    event.type === 'model/selection' ? { revision: event.seq + 1, selection: event.data, preferSelectedProvider: true } : state,
  wire: { viewSchema: threadModelPolicySchema, view: (state: ThreadModelPolicy) => state },
}

interface AccountsHost {
  readonly host: TestHost
  readonly mounted: MountedPlugin
  readonly chats: readonly ChatRequest[]
  /** Selections the Host asked the native session controller to make, in order. */
  readonly selected: readonly SelectionRequest[]
  readonly baseUrl: string
  startThread(input: { readonly sessionId: string; readonly provider: string; readonly reasoningEffort?: string }): Promise<Agent>
  ask(agent: Agent, text: string): Promise<void>
  dispose(): Promise<void>
}

interface StartInput {
  readonly accounts: readonly FixtureAccount[]
  /** Generated private Codex accounts (`codex_work_<32 hex>`) saved after the keyed ones. */
  readonly codexAccounts?: readonly string[]
  readonly distribution: 'sticky' | 'priority' | 'round-robin' | 'balanced'
  /** One reply per chat request, in order; requests past the end answer with text. */
  readonly replies?: readonly ChatReply[]
  /** Runs while a chat request is held, before its reply is written. */
  readonly onChat?: (input: { readonly request: ChatRequest; readonly index: number }) => void | Promise<void>
  /** Register a thread-model policy that treats every native selection as the user's explicit pick. */
  readonly userSelections?: boolean
  /**
   * The retry delay the provider adapter reports on every failed attempt. The pi-ai adapter drops a `Retry-After`
   * header, so without this a rate limit with no sibling waits the full policy minute.
   */
  readonly retryAfterMs?: number
  /** Runs on the Host context after the native services exist and before ai-accounts mounts. */
  readonly beforeMount?: (host: TestHost) => void | Promise<void>
}

const start = async (input: StartInput): Promise<AccountsHost> => {
  const chats: ChatRequest[] = []
  const selected: SelectionRequest[] = []
  const replies = [...(input.replies ?? [])]
  const server = createServer((request, response) => {
    void (async () => {
      const authorization = request.headers.authorization ?? ''
      const account = input.accounts.find(candidate => authorization === `Bearer ${keyFor(candidate.id)}`)?.id ?? 'unknown'
      if (request.url?.endsWith('/alpha/billing/subscriptions')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { planId: 'individual-pro' } }))
        return
      }
      if (request.url?.endsWith('/provider/v1/models')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: MODEL }] }))
        return
      }
      if (request.method !== 'POST' || request.url?.endsWith('/chat/completions') !== true) {
        response.writeHead(404, { 'content-type': 'application/json' }).end('{}')
        return
      }
      const body = Schema.decodeUnknownSync(Schema.fromJsonString(chatBodySchema))(await readText(request))
      const chat = { account, reasoningEffort: body.reasoning_effort }
      const index = chats.length
      chats.push(chat)
      await input.onChat?.({ request: chat, index })
      reply(response, replies[index] ?? { text: 'Done.' })
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The fixture server has no port.')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const root = join(home, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(join(home, 'plugins', 'ai-accounts'), { recursive: true })
  for (const account of input.accounts) process.env[keyEnvFor(account.id)] = keyFor(account.id)
  await writeFile(
    join(home, 'plugins', 'ai-accounts', 'accounts.json'),
    JSON.stringify({
      distribution: input.distribution,
      cooldownMs: 300_000,
      shadowRoot: '~/.codex-dshx-test',
      accounts: [...input.accounts.map(account => draft(account, baseUrl)), ...(input.codexAccounts ?? []).map(codexDraft)],
    }),
  )

  const host = await createTestHost()
  const ctx = host.ctx
  for (const plugin of [TypertRegistry, SessionStore, SessionProjectionRegistry, LlmRuntime, AgentRegistry, Storage]) await ctx.plugin(plugin)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(LocalCredentials, { dshHome: root, watch: false })
  await ctx.plugin(AgentLoop)
  ctx.provide('settings', { configure: () => () => undefined, describe: () => [], update: async () => undefined, replace: async () => undefined })
  ctx.provide('webServer', {})
  ctx.provide('sessionController', {
    selectModel: async (request: SelectionRequest) => {
      selected.push(request)
    },
  })
  if (input.userSelections === true) ctx.sessionProjections.register(userSelectionProjection)
  const retryAfterMs = input.retryAfterMs
  if (retryAfterMs !== undefined) {
    ctx.on('llm/stream', (_options, next) => withProviderRetryAfter(next(), retryAfterMs))
  }
  await input.beforeMount?.(host)
  const { default: plugin } = await import('./host.js')
  const mounted = await host.mount(plugin, { packageId: '@dshfiles/ai-accounts' })

  const handles: Array<{ dispose(): Promise<void> }> = []
  return {
    host,
    mounted,
    chats,
    selected,
    baseUrl,
    startThread: async thread => {
      const handle = await ctx.agents.create({
        sessionId: SessionId(thread.sessionId),
        meta: { cwd: root },
        agentOptions: {
          provider: thread.provider,
          model: MODEL,
          ...(thread.reasoningEffort !== undefined && { reasoningEffort: ReasoningEffortId(thread.reasoningEffort) }),
        },
      })
      handles.push(handle)
      return handle.agent
    },
    ask: async (agent, text) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    },
    dispose: async () => {
      for (const handle of handles.splice(0).reverse()) await handle.dispose()
      await mounted.dispose()
      await host.dispose()
      await new Promise<void>(resolve => server.close(() => resolve()))
      for (const account of input.accounts) delete process.env[keyEnvFor(account.id)]
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** One wire call of an ai-accounts Host API, decoded with the method's own output schema. */
const callApi = async <Output extends Schema.Top & { readonly DecodingServices: never }>(input: {
  readonly host: TestHost
  readonly apiId: string
  readonly method: string
  readonly payload: Schema.Json | undefined
  readonly output: Output
  readonly version?: number
}) => {
  const response = await input.host.connection.requestApi({
    packageId: '@dshfiles/ai-accounts',
    apiId: input.apiId,
    method: input.method,
    version: input.version ?? 1,
    input: input.payload,
  })
  return Schema.decodeUnknownSync(apiEnvelopeSchema(input.output))(await response.json()).result
}

export class AccountsHostFixture {
  static readonly model = MODEL
  static readonly start = start
  static readonly callApi = callApi
  static readonly managedCodexHome = managedCodexHome
  static readonly eventTypes = (agent: Agent): readonly string[] => agent.session.snapshotEvents().map(event => event.type)
  static readonly eventsOfType = (agent: Agent, type: SessionEvent['type']): readonly SessionEvent[] =>
    agent.session.snapshotEvents().filter(event => event.type === type)
}

export type { AccountsHost, ChatReply }
