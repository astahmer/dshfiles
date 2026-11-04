import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync, writeFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { basename, join } from 'node:path'
import { Schema } from 'effect'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { createTestHost, mountPlugin } from '@dshfiles/dshx/testing'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import type {} from '@dshfiles/project-checks/completion-event'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationSettings } from './settings.js'

/**
 * Mounts the real jj-integration Host half in a dshx test Host, with real `jj` and `git` processes and in-memory DSH
 * registries. Only the Host boundary is substituted: the workspace registry, Session controller and agents are plain
 * records the test drives, and `dshx checkout sync` answers from `checkoutSync` so a land never rebuilds this checkout.
 * Characterization support for the Effect-native rewrite; every assertion goes through the API, tools and events.
 */

const env = { ...process.env, JJ_CONFIG: '' }

export interface ActivityEvent {
  readonly type: string
  readonly level: string
  readonly summary: string
  readonly detail: string | null
  readonly sessionId: string | null
  readonly correlationId: string | null
  readonly workspaceId: string | null
}

interface SpawnSpec {
  readonly argv: readonly string[]
  readonly cwd?: string
  readonly signal?: AbortSignal
  /** Merged over the test environment, as DSH's subprocess runtime merges it over its scrubbed parent environment. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

interface SessionState {
  readonly running: boolean
  readonly questions: number
  readonly title?: string
  /** Its projections cannot be read and the Session list omits it, so its activity stays unknown. */
  readonly unreadable?: boolean
}

interface RegisteredWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly createdAt: string
  updatedAt: string
  sessionIds: string[]
}

export type CandidateVerdict = {
  readonly status: 'passed' | 'failed' | 'stale' | 'cancelled' | 'unavailable' | 'attempt-limit'
  readonly prompt: string | null
}

const unsupported = () => {
  throw new Error('not served by the characterization harness')
}

/** Stands in for the Project Checks plugin: authorizes every completion and answers candidate checks with `verdict`. */
const projectChecksProvider = (verdict: () => CandidateVerdict) =>
  defineHost({
    name: 'project-checks',
    apis: [
      projectChecksApi.host({
        actions: unsupported,
        receipts: unsupported,
        hookEvents: unsupported,
        run: unsupported,
        dispatch: unsupported,
        tasks: unsupported,
        cancelTask: unsupported,
        retryTask: unsupported,
        assertVerifiedCompletion: () => ({ status: 'authorized' }),
        verifyCandidate: () => verdict(),
      }),
    ],
  })

export interface CheckoutSyncCall {
  readonly argv: readonly string[]
  readonly startedAt: number
}

const collected = (text: string) => ({ readFrom: () => ({ text, lossy: false }) })

const syncResult = (status: string) =>
  JSON.stringify({
    ok: true,
    data: { status, rebuilt: { plugins: [] }, plugins: [], restart: { needed: false }, conflicts: [], hint: null },
  })

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

const initRepository = (repo: string): void => {
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env })
  jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
  jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
  writeFileSync(join(repo, 'shared.txt'), 'one\n')
  jj(repo, 'commit', '-m', 'base')
  jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
}

/** The browser Connection envelope a jj-integration API call answers with. */
const wireResponseSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

export type WireOutcome = 'ok' | { readonly code: string; readonly message: string }

/** A raw JSON request body, deliberately unchecked so invalid input reaches the Host's own validation. */
export type WireInput = Readonly<Record<string, string | number | boolean | readonly string[]>>

type ToolAgent = { readonly sessionId: string; readonly cwd: string }

const start = async (
  options: {
    readonly settings?: Partial<JjIntegrationSettings>
    /** Answers one `dshx checkout sync`; resolves to its JSON stdout. Defaults to an immediate `up-to-date`. */
    readonly checkoutSync?: (call: CheckoutSyncCall) => Promise<string>
  } = {},
) => {
  const host = await createTestHost()
  const events: ActivityEvent[] = []
  const prompts: { readonly sessionId: string; readonly text: string }[] = []
  const checkoutSyncs: CheckoutSyncCall[] = []
  const sessions = new Map<string, SessionState>()
  const workspaces: RegisteredWorkspace[] = []
  let settings: Partial<JjIntegrationSettings> = { ...options.settings }
  let settingsRevision = 1

  const runProcess = (spec: SpawnSpec) => {
    let stdout = ''
    let stderr = ''
    const isCheckoutSync = spec.argv.includes('checkout') && spec.argv.includes('sync') && spec.argv.includes('--json')
    if (isCheckoutSync) {
      const call = { argv: spec.argv, startedAt: Date.now() }
      checkoutSyncs.push(call)
      const answer = options.checkoutSync?.(call) ?? Promise.resolve(syncResult('up-to-date'))
      const stdoutStream = new PassThrough()
      const stderrStream = new PassThrough()
      const done = answer.then(text => {
        stdout = text
        stdoutStream.end(text)
        stderrStream.end()
        return { exitCode: 0 }
      })
      return {
        done,
        stdout: stdoutStream,
        stderr: stderrStream,
        terminate: () => {
          stdoutStream.end()
          stderrStream.end()
        },
        waitForExit: async () => {
          await done
          return true
        },
        collected: {
          get stdout() {
            return collected(stdout)
          },
          get stderr() {
            return collected(stderr)
          },
        },
      }
    }
    const [executable, ...args] = spec.argv
    if (executable === undefined) throw new Error('empty argv')
    const child = spawn(executable, args, { cwd: spec.cwd, env: { ...env, ...spec.env } })
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    const abort = (): void => {
      child.kill('SIGTERM')
    }
    spec.signal?.addEventListener('abort', abort, { once: true })
    const done = new Promise<{ exitCode: number | null }>(resolvePromise => {
      child.on('close', code => {
        spec.signal?.removeEventListener('abort', abort)
        resolvePromise({ exitCode: code })
      })
      child.on('error', () => resolvePromise({ exitCode: null }))
    })
    return {
      done,
      stdout: child.stdout,
      stderr: child.stderr,
      terminate: () => {
        child.kill('SIGTERM')
      },
      waitForExit: async () => {
        await done
        return true
      },
      collected: {
        get stdout() {
          return collected(stdout)
        },
        get stderr() {
          return collected(stderr)
        },
      },
    }
  }

  const workspaceView = (workspace: RegisteredWorkspace) => ({ ...workspace, sessionIds: [...workspace.sessionIds] })
  const registry = {
    get archivedSessionIds() {
      return []
    },
    list: () => workspaces.map(workspaceView),
    get: (id: string) => {
      const found = workspaces.find(workspace => workspace.id === id)
      return found === undefined ? undefined : workspaceView(found)
    },
    resolveByPath: async (path: string) => {
      const found = workspaces.find(workspace => workspace.path === path)
      return found === undefined ? undefined : workspaceView(found)
    },
    create: async (path: string, title?: string) => {
      const canonical = realpathSync(path)
      const existing = workspaces.find(workspace => workspace.path === canonical)
      if (existing !== undefined) return workspaceView(existing)
      const now = new Date().toISOString()
      const created: RegisteredWorkspace = {
        id: randomUUID(),
        path: canonical,
        title: title ?? basename(canonical),
        createdAt: now,
        updatedAt: now,
        sessionIds: [],
      }
      workspaces.unshift(created)
      return workspaceView(created)
    },
    delete: async (id: string) => {
      const index = workspaces.findIndex(workspace => workspace.id === id)
      if (index >= 0) workspaces.splice(index, 1)
    },
  }

  const projectionValues = (sessionId: string) => {
    const state = sessions.get(sessionId)
    if (state === undefined) return undefined
    return {
      title: state.title ?? null,
      userQuestions: { active: Array.from({ length: state.questions }, (_, index) => ({ id: `question-${String(index)}` })) },
      sessionListMetadata: { blank: false },
    }
  }

  host.ctx.provide('subprocess', {
    resolveExecutable: async (name: string) => name,
    spawn: runProcess,
  })
  host.ctx.provide('workspaceRegistry', registry)
  host.ctx.provide('agents', {
    get: (id: string) => {
      const state = sessions.get(String(id))
      return state === undefined ? undefined : { id, status: state.running ? 'running' : 'idle' }
    },
    list: () => [],
  })
  host.ctx.provide('sessionController', {
    list: async () => ({
      items: [...sessions]
        .filter(([, state]) => state.unreadable !== true)
        .map(([sessionId, state]) => ({
          sessionId,
          running: state.running,
          blank: false,
          projections: { values: projectionValues(sessionId) },
        })),
    }),
    projections: async (input: { readonly sessionId: string }) => {
      if (sessions.get(String(input.sessionId))?.unreadable === true) throw new Error('projection store unavailable')
      const values = projectionValues(String(input.sessionId))
      return values === undefined ? null : { values }
    },
    prompt: async (input: { readonly sessionId: string; readonly content: readonly { readonly text: string }[] }) => {
      prompts.push({ sessionId: String(input.sessionId), text: input.content.map(part => part.text).join('') })
    },
  })
  host.ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [{ ns: 'jj-integration', value: settings, revision: settingsRevision }],
    update: async () => undefined,
    replace: async () => undefined,
  })
  host.ctx.on('dshfiles/activity/event', payload => {
    events.push(payload.value)
  })

  let verdict: CandidateVerdict = { status: 'passed', prompt: null }
  const projectChecks = await host.mount(
    projectChecksProvider(() => verdict),
    { packageId: '@dshfiles/project-checks' },
  )
  const plugin: unknown = await import('./host.js')
  const mounted = await mountPlugin(host, plugin, { packageId: '@dshfiles/jj-integration', native: true })

  const api = createHostApiClient(host.ctx, jjIntegrationApi, '@dshfiles/jj-integration')

  /** Posts one call exactly as a browser does and reads back the wire outcome. */
  const wire = async (method: keyof typeof jjIntegrationApi.methods, input: WireInput): Promise<WireOutcome> => {
    const response = await host.connection.requestApi({
      packageId: '@dshfiles/jj-integration',
      apiId: jjIntegrationApi.id,
      method,
      version: jjIntegrationApi.version,
      input,
    })
    const body = Schema.decodeUnknownSync(wireResponseSchema)(await response.json())
    return body.result.ok ? 'ok' : { code: body.result.error.code, message: body.result.error.message }
  }

  /** Runs one agent tool as the given Session, the way a model call reaches it. */
  const runTool = async (name: string, args: WireInput, agent: ToolAgent): Promise<string> => {
    const tool = host.tools.get(name)
    if (tool === undefined) throw new Error(`tool ${name} is not registered`)
    // SAFETY: a dshx API tool reads only `signal`, `agent.id` and `agent.session.header.cwd` from its execution.
    const execution = {
      signal: new AbortController().signal,
      agent: { id: agent.sessionId, session: { id: agent.sessionId, header: { cwd: agent.cwd } } },
    } as never
    return JSON.stringify(await tool.execute({ ...args }, execution))
  }

  return {
    host,
    events,
    prompts,
    checkoutSyncs,
    api,
    wire,
    runTool,
    /** Commits a new settings revision and announces it, as DSH does after a settings write. */
    setSettings: (next: Partial<JjIntegrationSettings>) => {
      settings = { ...next }
      settingsRevision += 1
      // SAFETY: SettingsNamespace is a type-only brand over the namespace string.
      host.ctx.emit('settings/document-updated', 'jj-integration' as never, settingsRevision)
    },
    setSession: (sessionId: string, state: SessionState) => {
      sessions.set(sessionId, state)
    },
    register: async (path: string, sessionIds: readonly string[] = []) => {
      const workspace = await registry.create(path)
      const stored = workspaces.find(entry => entry.id === workspace.id)
      if (stored !== undefined) stored.sessionIds = [...sessionIds]
      return workspace.id
    },
    unregister: (path: string) => {
      const index = workspaces.findIndex(workspace => workspace.path === path)
      if (index >= 0) workspaces.splice(index, 1)
    },
    workspacePath: (workspaceId: string) => {
      const found = workspaces.find(workspace => workspace.id === workspaceId)
      if (found === undefined) throw new Error(`workspace ${workspaceId} is not registered`)
      return found.path
    },
    /** Provisions a thread workspace through the API and describes one change in it. */
    provisionThread: async (repo: string, input: { readonly sessionIds?: readonly string[]; readonly file?: string } = {}) => {
      const projectId = (await registry.create(repo)).id
      const { workspaceId } = await api.provision({ workspaceId: projectId, isolate: true })
      const stored = workspaces.find(workspace => workspace.id === workspaceId)
      if (stored === undefined) throw new Error('provisioned workspace was not registered')
      stored.sessionIds = [...(input.sessionIds ?? [])]
      const file = input.file ?? `${basename(stored.path)}.txt`
      writeFileSync(join(stored.path, file), `${file}\n`)
      jj(stored.path, 'describe', '-m', `feat: add ${file}`)
      return stored.path
    },
    emitSessionEvent: (sessionId: string, type: SessionEvent['type'] = 'assistant/message') => {
      // SAFETY: jj-integration's Session-event listener reads only `session.id` and `session.header.cwd`.
      const session = { id: SessionId(sessionId), header: { cwd: undefined } } as unknown as Session
      // SAFETY: the same listener reads only `event.type`.
      const event = { type } as unknown as SessionEvent
      host.ctx.emit('session/event', session, event)
    },
    setCandidateVerdict: (next: CandidateVerdict) => {
      verdict = next
    },
    /** Fires Project Checks' verified-turn event for the thread at `path`, as the plugin does after its checks pass. */
    verifyTurn: async (input: { readonly sessionId: string; readonly path: string; readonly turn?: number; readonly sourceRevision?: string }) => {
      const agentFixes: string[] = []
      const sourceRevision = input.sourceRevision ?? jj(input.path, 'log', '--no-graph', '-r', '@', '-T', 'commit_id').trim()
      await host.ctx.serial('dshfiles/project-checks/verified', {
        sessionId: SessionId(input.sessionId),
        turn: input.turn ?? 1,
        sourceRevision,
        signal: new AbortController().signal,
        requestAgentFix: message => agentFixes.push(message),
      })
      return agentFixes
    },
    dispose: async () => {
      await mounted.dispose()
      await projectChecks.dispose()
      await host.dispose()
    },
  }
}

export class JjIntegrationTestHost {
  static readonly start = start
  static readonly jj = jj
  static readonly initRepository = initRepository
}

export type JjIntegrationTestHarness = Awaited<ReturnType<typeof start>>
