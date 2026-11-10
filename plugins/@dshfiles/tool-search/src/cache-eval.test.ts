import { readFileSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmError, LlmRuntime, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import toolSearch from './host.js'
import { MeasuredCodexAdapter, RequestBudget, benchmarkAccount, benchmarkEffort, benchmarkModel } from './provider-route.test-support.js'

/**
 * Opt-in real-model evaluation of the three tool configurations on the live catalog: every tool schema and the fixed
 * instructions one live `web` request carried, captured as `{ tools, instructions }` from its Session log. Tools answer
 * from in-memory fixtures; success is judged from the recorded call, its arguments, the fixture side effect and the
 * final answer.
 */
const evalEnabled = process.env.DSH_TOOL_SEARCH_EVAL === '1'
const catalogPath = process.env.DSH_TOOL_SEARCH_EVAL_CATALOG
const outputPath = process.env.DSH_TOOL_SEARCH_EVAL_OUTPUT
const requestBudget = Number(process.env.DSH_TOOL_SEARCH_EVAL_REQUEST_BUDGET ?? '220')
const taskFilter = process.env.DSH_TOOL_SEARCH_EVAL_TASKS?.split(',')
const modeFilter = process.env.DSH_TOOL_SEARCH_EVAL_MODES?.split(',')

const capturedSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.Record(Schema.String, Schema.Unknown) })),
  instructions: Schema.Array(Schema.Struct({ kind: Schema.String, text: Schema.String })),
})

/** The names an agent preset mounts on the agent plane in `web`: never global, so tool-search never defers them. */
const agentPlanePatterns = [
  /^bash$/,
  /^read$/,
  /^write$/,
  /^edit$/,
  /^todo_write$/,
  /^skill$/,
  /^ask_user_question$/,
  /^job_/,
  /^send_message$/,
  /^subagent/,
  /^list_agents$/,
  /^interrupt_agent$/,
  /^web_search$/,
  /^web_fetch$/,
  /^present$/,
  /^read_image$/,
  /^exit_plan_mode$/,
  /^workflow$/,
  /^schedule_/,
]

type Mode = 'direct' | 'progressive' | 'cache-safe'

interface Call {
  readonly name: string
  readonly args: string
}

interface World {
  readonly files: Map<string, string>
  readonly calls: Call[]
}

type Fixture = (args: Record<string, unknown>, world: World) => string

interface EvalTask {
  readonly id: string
  readonly family: string
  readonly prompt: string
  readonly fixtures: Readonly<Record<string, Fixture>>
  readonly success: (input: { readonly calls: readonly Call[]; readonly answer: string; readonly world: World }) => boolean
}

const text =
  (value: string): Fixture =>
  () =>
    value
const called = (calls: readonly Call[], names: readonly string[], argument?: (args: string) => boolean) =>
  calls.some(call => names.includes(call.name) && (argument === undefined || argument(call.args)))
const says = (answer: string, fact: string) => answer.toLowerCase().includes(fact.toLowerCase())

const fileContent = (world: World, args: Record<string, unknown>): [string, string] | undefined => {
  const path = String(args['file_path'] ?? args['path'] ?? '')
  const match = [...world.files.entries()].find(([name]) => path === name || path.endsWith(`/${name}`))
  return match
}

const readFixture: Fixture = (args, world) => {
  const file = fileContent(world, args)
  if (file === undefined) return 'File not found.'
  return file[1]
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')
}

const editFixture: Fixture = (args, world) => {
  const file = fileContent(world, args)
  const oldText = String(args['old_string'] ?? '')
  if (file === undefined || oldText.length === 0 || !file[1].includes(oldText)) return 'Error: old_string not found.'
  world.files.set(file[0], file[1].replace(oldText, String(args['new_string'] ?? '')))
  return 'The file has been updated successfully.'
}

const applyPatchFixture: Fixture = (args, world) => {
  const file = fileContent(world, args)
  if (file === undefined) return 'Error: file not found.'
  let next = file[1]
  const edits = Array.isArray(args['edits']) ? args['edits'] : []
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) continue
    const oldText = 'old' in edit ? String(edit.old) : ''
    if (!next.includes(oldText)) return 'Error: anchor not found.'
    next = next.replace(oldText, 'new' in edit ? String(edit.new) : '')
  }
  world.files.set(file[0], next)
  return 'Patched.'
}

const writeFixture: Fixture = (args, world) => {
  const file = fileContent(world, args)
  if (file === undefined) return 'Error: only existing benchmark files can be written.'
  world.files.set(file[0], String(args['content'] ?? ''))
  return 'Written.'
}

const bashFixture: Fixture = args => {
  const command = String(args['command'] ?? '')
  if (/pnpm\s+(run\s+)?test/.test(command)) return 'Test Files 7 passed (7)\n     Tests 42 passed (42)\n  Duration 3.1s'
  if (/\bcat\b.*package\.json/.test(command)) return '{ "name": "acme-widgets", "scripts": { "test": "vitest run" } }'
  if (/^\s*(ls|pwd)/.test(command)) return 'README.md\npackage.json\nsrc'
  return '(no output)'
}

const fileFixtures = { read: readFixture, edit: editFixture, apply_patch: applyPatchFixture, write: writeFixture, bash: bashFixture }

const quota = 'Codex Alex2 (plus): weekly window 37% remaining, resets 2026-11-14; 5-hour window 82% remaining.'
const earlier = "Thread 'Rate limiter rewrite' (2026-10-02): decided to migrate the rate limiter to a token bucket per account."

const tasks: readonly EvalTask[] = [
  {
    id: 'backlog-open',
    family: 'backlog',
    prompt: "What's open in my task tracker for this project right now? Give me the titles.",
    fixtures: {
      backlog_list: text("b:k3f9 'Sidebar flickers on resize' (bug, todo); b:m2x1 'Add export button' (task, inbox)."),
      backlog_ready: text("b:k3f9 'Sidebar flickers on resize' (bug, todo); b:m2x1 'Add export button' (task, inbox)."),
    },
    success: ({ calls, answer }) => called(calls, ['backlog_list', 'backlog_ready']) && says(answer, 'flicker'),
  },
  {
    id: 'backlog-capture',
    family: 'backlog',
    prompt: 'Put this in my backlog for later, do not fix it now: bug — the export button is misaligned on mobile. Tell me the id it got.',
    fixtures: { backlog_capture: text('Captured b:q7w2 (bug, inbox).') },
    success: ({ calls, answer }) => called(calls, ['backlog_capture'], args => args.includes('misaligned')) && says(answer, 'q7w2'),
  },
  {
    id: 'jj-unlanded',
    family: 'jj',
    prompt: "Which revisions in this thread's workspace are not on main yet?",
    fixtures: {
      jj_thread_status: text("2 revisions not on main: 9f3a2c1 'feat: add export' and 4b7d0e2 'test: cover export'. Safe to rebase."),
      bash: (args, world) => (/\bjj\b/.test(String(args['command'] ?? '')) ? '9f3a2c1 feat: add export\n4b7d0e2 test: cover export' : bashFixture(args, world)),
    },
    success: ({ calls, answer }) => (called(calls, ['jj_thread_status']) || called(calls, ['bash'], args => /\bjj\b/.test(args))) && says(answer, '9f3a2c1'),
  },
  {
    id: 'preview-title',
    family: 'preview',
    prompt: 'Open http://localhost:5173 in the preview browser and tell me the page title.',
    fixtures: { preview_open: text("Opened page p1: http://localhost:5173/ — title 'Acme Dashboard', HTTP 200.") },
    success: ({ calls, answer }) => called(calls, ['preview_open'], args => args.includes('5173')) && says(answer, 'acme dashboard'),
  },
  {
    id: 'schedule-reminder',
    family: 'schedule',
    prompt: 'Remind me in 2 hours to check the deploy.',
    fixtures: { schedule_create: text('Created reminder sch_41, due in 2 hours.') },
    success: ({ calls }) => called(calls, ['schedule_create'], args => args.includes('7200') || args.includes('deploy')),
  },
  {
    id: 'usage-cost',
    family: 'usage',
    prompt: 'How much did my model usage cost over the last 7 days?',
    fixtures: {
      usage_report: text('2026-11-03 to 2026-11-10: list-price cost $12.40 across 214 requests; top model gpt-6-luna.'),
      usage_requests: text('214 requests, total list-price cost $12.40.'),
    },
    success: ({ calls, answer }) => called(calls, ['usage_report', 'usage_requests']) && says(answer, '12.4'),
  },
  {
    id: 'remote-hosts',
    family: 'multi-host',
    prompt: 'Which remote machines can I run threads on, and is any of them disconnected?',
    fixtures: { multi_host_list: text('mac-mini: runtime connected. gpu-box: runtime disconnected (last error: ssh timeout).') },
    success: ({ calls, answer }) => called(calls, ['multi_host_list', 'multi_host_status']) && says(answer, 'gpu-box'),
  },
  {
    id: 'settings-read',
    family: 'settings',
    prompt: 'Which web search provider is configured in my DSH settings?',
    fixtures: { settings_list: text("Namespace dshfiles-settings-web-search (revision 4): { provider: 'brave', resultCount: 8 }.") },
    success: ({ calls, answer }) => called(calls, ['settings_list']) && says(answer, 'brave'),
  },
  {
    id: 'memory-decision',
    family: 'memory',
    prompt: 'Did we already decide something about the rate limiter in an earlier conversation? What was it?',
    fixtures: { memory_search: text(earlier), find_threads: text(earlier), memory_read: text(earlier) },
    success: ({ calls, answer }) => called(calls, ['memory_search', 'find_threads'], args => args.includes('rate')) && says(answer, 'token bucket'),
  },
  {
    id: 'traces-errors',
    family: 'traces',
    prompt: 'Something in the harness keeps failing this last hour. Which error is the most frequent?',
    fixtures: { traces_error_groups: text('1) service jj, span "jj fetch", error ECONNRESET: 14 errors. 2) service llm, span "chat", TIMEOUT: 3 errors.') },
    success: ({ calls, answer }) => called(calls, ['traces_error_groups']) && says(answer, 'econnreset'),
  },
  {
    id: 'thread-rename',
    family: 'thread',
    prompt: "Rename the thread session-abc123 to 'Export work'.",
    fixtures: { thread_rename: text("Renamed session-abc123 to 'Export work'.") },
    success: ({ calls }) => called(calls, ['thread_rename'], args => args.includes('session-abc123') && args.includes('export work')),
  },
  {
    id: 'thread-archive',
    family: 'thread',
    prompt: 'Archive the thread session-old42, I am done with it.',
    fixtures: { thread_archive: text('Archived session-old42.') },
    success: ({ calls }) => called(calls, ['thread_archive'], args => args.includes('session-old42')),
  },
  {
    id: 'read-readme',
    family: 'files',
    prompt: 'Read README.md in the project and tell me the project name in its title.',
    fixtures: fileFixtures,
    success: ({ calls, answer }) => called(calls, ['read', 'bash']) && says(answer, 'acme widgets'),
  },
  {
    id: 'edit-port',
    family: 'files',
    prompt: 'In src/config.ts, change the port from 3000 to 4000.',
    fixtures: fileFixtures,
    success: ({ world }) => world.files.get('src/config.ts')?.includes('4000') === true,
  },
  {
    id: 'bash-tests',
    family: 'files',
    prompt: 'Run the project tests with pnpm test and tell me how many tests passed.',
    fixtures: fileFixtures,
    success: ({ calls, answer }) => called(calls, ['bash'], args => args.includes('pnpm')) && says(answer, '42'),
  },
  {
    id: 'subscription-left',
    family: 'ai-accounts',
    prompt: 'How much of my ChatGPT subscription allowance is left this week?',
    fixtures: { ai_accounts_quota: text(quota), ai_accounts_refresh_quota: text(quota) },
    success: ({ calls, answer }) => called(calls, ['ai_accounts_quota', 'ai_accounts_refresh_quota']) && says(answer, '37'),
  },
  {
    id: 'running-jobs',
    family: 'background-jobs',
    prompt: 'Is anything still running in the background across all my threads? Name each job.',
    fixtures: { background_jobs_board: text("2 running jobs: 'vitest-shard-7' (tests, 4m12s); 'tsc-watch' (typecheck, 31m).") },
    success: ({ calls, answer }) => called(calls, ['background_jobs_board']) && says(answer, 'vitest-shard-7'),
  },
  {
    id: 'secret-aliases',
    family: 'secrets',
    prompt: 'Which secret aliases are configured for this workspace? Just the names, never values.',
    fixtures: { secret_list: text('OPENAI_API_KEY (global, prod); GITHUB_TOKEN (project, prod).') },
    success: ({ calls, answer }) => called(calls, ['secret_list']) && says(answer, 'github_token'),
  },
  {
    id: 'linked-prs',
    family: 'pull-requests',
    prompt: 'Which pull requests are linked to this thread, and what state are they in?',
    fixtures: { pull_request_list: text("#128 'Export button' — open, checks passing, watched."), backlog_pull_requests: text('No linked pull requests.') },
    success: ({ calls, answer }) => called(calls, ['pull_request_list']) && says(answer, '128'),
  },
  {
    id: 'whiteboards',
    family: 'whiteboard',
    prompt: 'List my whiteboards in this project.',
    fixtures: { whiteboard_list: text("wb_1 'Architecture' (12 elements, revision 7); wb_2 'Onboarding flow' (5 elements).") },
    success: ({ calls, answer }) => called(calls, ['whiteboard_list']) && says(answer, 'architecture'),
  },
]

const initialFiles = (): Map<string, string> =>
  new Map([
    ['README.md', '# Acme Widgets\n\nA widget dashboard.\n'],
    ['src/config.ts', 'export const port = 3000\nexport const host = "127.0.0.1"\n'],
    ['package.json', '{ "name": "acme-widgets", "scripts": { "test": "vitest run" } }\n'],
  ])

const definitionOf = (input: {
  readonly schema: (typeof capturedSchema.Type)['tools'][number]
  readonly task: EvalTask
  readonly world: World
}): ToolDefinition => ({
  name: input.schema.name,
  description: input.schema.description,
  parameters: input.schema.parameters,
  output: {
    schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
    render: (_args, value) => [
      { type: 'text', text: typeof value === 'object' && value !== null && 'result' in value ? String(value.result) : JSON.stringify(value) },
    ],
  },
  execute: async args => {
    const record = typeof args === 'object' && args !== null && !Array.isArray(args) ? Object.fromEntries(Object.entries(args)) : {}
    input.world.calls.push({ name: input.schema.name, args: JSON.stringify(record).toLowerCase() })
    const fixture = input.task.fixtures[input.schema.name]
    return { result: fixture === undefined ? 'No matching data.' : fixture(record, input.world) }
  },
})

interface ScenarioRequest {
  readonly toolCount: number
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly elapsedMs: number
}

interface ScenarioResult {
  readonly taskId: string
  readonly family: string
  readonly mode: Mode
  readonly success: boolean
  readonly calls: readonly string[]
  readonly errors: readonly string[]
  readonly requests: readonly ScenarioRequest[]
  readonly wallMs: number
  readonly answer: string
}

const runScenario = async (input: {
  readonly mode: Mode
  readonly task: EvalTask
  readonly catalog: typeof capturedSchema.Type
  readonly budget: RequestBudget
}): Promise<ScenarioResult> => {
  const ctx = new Context()
  const world: World = { files: initialFiles(), calls: [] }
  const errors: string[] = []
  ctx.on('agent/error', event => {
    errors.push(event.error instanceof LlmError ? event.error.code : event.error instanceof Error ? event.error.message.slice(0, 200) : 'unknown')
  })
  let disposeAgent: (() => Promise<void>) | undefined
  let disposePreset: (() => Promise<void>) | undefined
  const startedAt = performance.now()
  try {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop)
    ctx.systemPrompt.section({
      name: 'live-instructions',
      order: 0,
      interpolate: false,
      text: input.catalog.instructions.map(instruction => instruction.text).join('\n\n'),
    })
    const agentPlane = input.catalog.tools.filter(schema => agentPlanePatterns.some(pattern => pattern.test(schema.name)))
    for (const schema of input.catalog.tools) if (!agentPlane.includes(schema)) ctx.tools.register(definitionOf({ schema, task: input.task, world }))
    if (input.mode !== 'direct') {
      if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing.')
      await ctx.plugin({ ...toolSearch, apply: toolSearch.setup }, { mode: input.mode })
    }
    const adapter = new MeasuredCodexAdapter({ ctx, maximumRequests: 8, budget: input.budget })
    ctx.llm.registerAdapter([benchmarkAccount], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-eval-${input.mode}-${input.task.id}-${Date.now()}`),
      agentOptions: { provider: benchmarkAccount, model: benchmarkModel, reasoningEffort: ReasoningEffortId(benchmarkEffort) },
    })
    disposeAgent = () => handle.dispose()
    const presetKey = { preset: 'eval-core' }
    const agentKey = scopeOf(handle.agent.ctx)
    if (agentKey === undefined) throw new Error('agent has no scope key')
    bindScopeParent(agentKey, presetKey)
    const preset = await new Promise<ReturnType<typeof createScope>>(resolve => {
      ctx.plugin({ inject: ['tools'], apply: (owner: Context) => resolve(createScope(owner, presetKey)) })
    })
    disposePreset = preset.dispose
    for (const schema of agentPlane) preset.ctx.tools.register(definitionOf({ schema, task: input.task, world }))

    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: input.task.prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const answer = adapter.requests.findLast(request => request.finishKind === 'stop')?.text ?? ''
    return {
      taskId: input.task.id,
      family: input.task.family,
      mode: input.mode,
      success: errors.length === 0 && input.task.success({ calls: world.calls, answer, world }),
      calls: world.calls.map(call => call.name),
      errors,
      requests: adapter.requests.map(request => ({
        toolCount: request.toolNames.length,
        inputTokens: request.usage?.inputTokens ?? 0,
        cacheReadTokens: request.usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: request.usage?.cacheWriteTokens ?? 0,
        outputTokens: request.usage?.outputTokens ?? 0,
        elapsedMs: request.elapsedMs,
      })),
      wallMs: Math.round(performance.now() - startedAt),
      answer: answer.slice(0, 300),
    }
  } finally {
    await disposeAgent?.()
    await disposePreset?.()
    await ctx.fiber.dispose()
  }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** Uncached input + 10 % of cached input + output: what the request costs in input-token units at a 90 % cache discount. */
const billedEquivalent = (request: ScenarioRequest): number =>
  request.inputTokens + 0.1 * request.cacheReadTokens + 1.25 * request.cacheWriteTokens + request.outputTokens

const summarize = (results: readonly ScenarioResult[]) => {
  const requests = results.flatMap(result => result.requests)
  return {
    scenarios: results.length,
    successes: results.filter(result => result.success).length,
    requests: requests.length,
    inputTokens: sum(requests.map(request => request.inputTokens + request.cacheReadTokens)),
    cachedInputTokens: sum(requests.map(request => request.cacheReadTokens)),
    uncachedInputTokens: sum(requests.map(request => request.inputTokens)),
    outputTokens: sum(requests.map(request => request.outputTokens)),
    billedEquivalentTokens: Math.round(sum(requests.map(billedEquivalent))),
    wallSeconds: Math.round(sum(results.map(result => result.wallMs)) / 1000),
    failures: results
      .filter(result => !result.success)
      .map(result => ({ taskId: result.taskId, calls: result.calls, errors: result.errors, answer: result.answer })),
  }
}

describe.skipIf(!evalEnabled)('tool-search real-model evaluation', () => {
  it('runs the evaluation tasks without tool-search, with progressive and with cache-safe tool-search', async () => {
    if (catalogPath === undefined) throw new Error('Set DSH_TOOL_SEARCH_EVAL_CATALOG to a captured { tools, instructions } file.')
    const catalog = Schema.decodeUnknownSync(Schema.fromJsonString(capturedSchema))(readFileSync(catalogPath, 'utf8'))
    const budget = new RequestBudget(requestBudget)
    const modes = (['direct', 'progressive', 'cache-safe'] as const).filter(mode => modeFilter === undefined || modeFilter.includes(mode))
    const selected = tasks.filter(task => taskFilter === undefined || taskFilter.includes(task.id))
    const results: ScenarioResult[] = []
    for (const [index, task] of selected.entries()) {
      const order = [...modes.slice(index % 3), ...modes.slice(0, index % 3)]
      for (const mode of order) {
        if (budget.limit - budget.used < 8) break
        const result = await runScenario({ mode, task, catalog, budget })
        results.push(result)
        console.info(
          JSON.stringify({ task: task.id, mode, success: result.success, requests: result.requests.length, calls: result.calls, errors: result.errors }),
        )
      }
    }
    const report = {
      route: { provider: benchmarkAccount, model: benchmarkModel, reasoningEffort: benchmarkEffort },
      catalog: { tools: catalog.tools.length, instructionChars: sum(catalog.instructions.map(instruction => instruction.text.length)) },
      providerRequests: budget.used,
      byMode: Object.fromEntries(modes.map(mode => [mode, summarize(results.filter(result => result.mode === mode))])),
      scenarios: results,
    }
    if (outputPath !== undefined) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
    console.info(JSON.stringify({ providerRequests: report.providerRequests, byMode: report.byMode }))
    expect(results.length).toBeGreaterThan(0)
  }, 7_200_000)
})
