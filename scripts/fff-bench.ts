#!/usr/bin/env node

/**
 * Does the fff MCP server (https://github.com/dmtrKovalenko/fff) make a coding
 * agent find code faster or cheaper than its built-in Grep/Glob? Runs headless
 * `claude -p` sessions per task and arm against a pinned corpus, then reports
 * wall time, turns, tokens, tool-result bytes, cost and answer accuracy.
 *
 *   node scripts/fff-bench.ts --corpus <dir> --fff <fff-mcp binary> --out <dir>
 *     [--arms baseline,fff,fff-only] [--reps 2] [--model sonnet] [--parallel 3] [--only <task-id>]
 *   node scripts/fff-bench.ts --report <out dir>
 *
 * Sessions skip user/project settings, hooks, CLAUDE.md and every MCP server
 * except fff, so only the arm differs between runs.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import * as Schema from 'effect/Schema'
import { ScriptJson } from './json.ts'

const Task = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  expect: Schema.optionalKey(Schema.Array(Schema.String)),
  recall: Schema.optionalKey(Schema.Array(Schema.String)),
})
type Task = Schema.Schema.Type<typeof Task>
const TaskFile = Schema.Struct({ corpus: Schema.String, tasks: Schema.Array(Task) })

const AssistantEvent = Schema.Struct({
  type: Schema.Literal('assistant'),
  message: Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.optionalKey(Schema.String) })) }),
})
const ToolResultContent = Schema.Union([Schema.String, Schema.Array(Schema.Struct({ text: Schema.optionalKey(Schema.String) }))])
const UserEvent = Schema.Struct({
  type: Schema.Literal('user'),
  message: Schema.Struct({
    content: Schema.Union([Schema.String, Schema.Array(Schema.Struct({ type: Schema.String, content: Schema.optionalKey(ToolResultContent) }))]),
  }),
})
const ResultEvent = Schema.Struct({
  type: Schema.Literal('result'),
  is_error: Schema.Boolean,
  result: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Number,
  duration_api_ms: Schema.Number,
  num_turns: Schema.Number,
  total_cost_usd: Schema.Number,
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
    cache_creation_input_tokens: Schema.Number,
    cache_read_input_tokens: Schema.Number,
  }),
})
const StreamEvent = Schema.Union([AssistantEvent, UserEvent, ResultEvent])
type StreamEvent = Schema.Schema.Type<typeof StreamEvent>
const decodeStreamEvent = (line: string): StreamEvent | undefined => {
  try {
    return ScriptJson.decodeJson(StreamEvent, line)
  } catch {
    return undefined
  }
}

const RunRecord = Schema.Struct({
  task: Schema.String,
  arm: Schema.String,
  rep: Schema.Number,
  ok: Schema.Boolean,
  score: Schema.Number,
  wallMs: Schema.Number,
  sessionMs: Schema.Number,
  apiMs: Schema.Number,
  turns: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
  toolResultChars: Schema.Number,
  toolCalls: Schema.Record(Schema.String, Schema.Number),
  answer: Schema.String,
})
type RunRecord = Schema.Schema.Type<typeof RunRecord>

const fffHint = 'For any file search or grep in the current git-indexed directory, use fff tools.'
const answerRule = 'Answer from the repository only. End with one line starting `ANSWER:` that lists the repo-relative path(s) and any value asked for.'
const readOnlyBash = ['rg', 'fd', 'find', 'grep', 'ls', 'cat', 'head', 'tail', 'sed', 'wc'].map(command => `Bash(${command}:*)`)

const arms = {
  baseline: { tools: 'Read,Grep,Glob,Bash', allowed: ['Read', 'Grep', 'Glob', ...readOnlyBash], fff: false },
  fff: { tools: 'Read,Grep,Glob,Bash', allowed: ['Read', 'Grep', 'Glob', ...readOnlyBash, 'mcp__fff'], fff: true },
  'fff-only': { tools: 'Read', allowed: ['Read', 'mcp__fff'], fff: true },
} as const
const ArmName = Schema.Literals(['baseline', 'fff', 'fff-only'])
type ArmName = Schema.Schema.Type<typeof ArmName>

const score = (task: Task, answer: string): number => {
  const haystack = answer.toLowerCase()
  if (task.recall !== undefined) {
    return task.recall.filter(needle => haystack.includes(needle.toLowerCase())).length / task.recall.length
  }
  return (task.expect ?? []).every(needle => haystack.includes(needle.toLowerCase())) ? 1 : 0
}

const runOnce = async (options: {
  task: Task
  arm: ArmName
  rep: number
  corpus: string
  fffBinary: string
  model: string
  scratch: string
}): Promise<RunRecord> => {
  const arm = arms[options.arm]
  const runDir = join(options.scratch, `${options.task.id}.${options.arm}.${options.rep}`)
  mkdirSync(runDir, { recursive: true })
  const mcpConfigPath = join(runDir, 'mcp.json')
  const servers = arm.fff
    ? {
        fff: {
          command: options.fffBinary,
          args: [
            '--no-update-check',
            '--frecency-db',
            join(runDir, 'frecency.db'),
            '--history-db',
            join(runDir, 'history.db'),
            '--log-file',
            join(runDir, 'fff.log'),
            options.corpus,
          ],
        },
      }
    : {}
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: servers }))

  const args = [
    '-p',
    `${options.task.prompt}\n\n${answerRule}`,
    '--model',
    options.model,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfigPath,
    '--tools',
    arm.tools,
    '--allowedTools',
    arm.allowed.join(','),
    '--permission-mode',
    'dontAsk',
    ...(arm.fff ? ['--append-system-prompt', fffHint] : []),
  ]
  const startedAt = performance.now()
  const child = spawn('claude', args, { cwd: options.corpus, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
  child.stderr.resume()
  await new Promise(done => child.on('close', done))
  const wallMs = Math.round(performance.now() - startedAt)
  writeFileSync(join(runDir, 'stream.jsonl'), stdout)

  const toolCalls: Record<string, number> = {}
  let toolResultChars = 0
  let result: Schema.Schema.Type<typeof ResultEvent> | undefined
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const event = decodeStreamEvent(line)
    if (event === undefined) continue
    if (event.type === 'assistant') {
      for (const part of event.message.content) {
        if (part.type === 'tool_use' && part.name !== undefined) toolCalls[part.name] = (toolCalls[part.name] ?? 0) + 1
      }
    }
    if (event.type === 'user' && Array.isArray(event.message.content)) {
      for (const part of event.message.content) {
        if (part.type === 'tool_result') {
          const content = part.content
          toolResultChars +=
            typeof content === 'string' ? content.length : Array.isArray(content) ? content.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) : 0
        }
      }
    }
    if (event.type === 'result') result = event
  }

  const answer = result?.result ?? ''
  return {
    task: options.task.id,
    arm: options.arm,
    rep: options.rep,
    ok: result !== undefined && !result.is_error,
    score: score(options.task, answer),
    wallMs,
    sessionMs: result?.duration_ms ?? 0,
    apiMs: result?.duration_api_ms ?? 0,
    turns: result?.num_turns ?? 0,
    inputTokens: result === undefined ? 0 : result.usage.input_tokens + result.usage.cache_creation_input_tokens + result.usage.cache_read_input_tokens,
    outputTokens: result?.usage.output_tokens ?? 0,
    costUsd: result?.total_cost_usd ?? 0,
    toolResultChars,
    toolCalls,
    answer: answer
      .split('\n')
      .filter(line => line.startsWith('ANSWER:'))
      .join(' ')
      .slice(0, 400),
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const report = (outDir: string): void => {
  const records = readFileSync(join(outDir, 'runs.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => ScriptJson.decodeJson(RunRecord, line))
  const armNames = [...new Set(records.map(record => record.arm))]
  const rows = armNames.map(armName => {
    const runs = records.filter(record => record.arm === armName)
    const sum = (pick: (record: RunRecord) => number): number => runs.reduce((total, record) => total + pick(record), 0)
    return {
      arm: armName,
      runs: runs.length,
      failures: runs.filter(record => !record.ok).length,
      accuracy: (sum(record => record.score) / runs.length).toFixed(3),
      medianWallS: (median(runs.map(record => record.wallMs)) / 1000).toFixed(1),
      totalWallS: (sum(record => record.wallMs) / 1000).toFixed(0),
      medianSessionS: (median(runs.map(record => record.sessionMs)) / 1000).toFixed(1),
      medianApiS: (median(runs.map(record => record.apiMs)) / 1000).toFixed(1),
      medianTurns: median(runs.map(record => record.turns)),
      totalTurns: sum(record => record.turns),
      totalInputKTok: (sum(record => record.inputTokens) / 1000).toFixed(0),
      totalOutputKTok: (sum(record => record.outputTokens) / 1000).toFixed(1),
      toolResultKChars: (sum(record => record.toolResultChars) / 1000).toFixed(1),
      costUsd: sum(record => record.costUsd).toFixed(2),
    }
  })
  console.table(rows)
  const taskIds = [...new Set(records.map(record => record.task))]
  console.table(
    taskIds.map(taskId => {
      const perArm = Object.fromEntries(
        armNames.map(armName => {
          const runs = records.filter(record => record.task === taskId && record.arm === armName)
          const wall = (median(runs.map(record => record.sessionMs)) / 1000).toFixed(0)
          const turns = median(runs.map(record => record.turns))
          const accuracy = (runs.reduce((total, record) => total + record.score, 0) / Math.max(runs.length, 1)).toFixed(2)
          return [armName, `${wall}s ${turns}t ${accuracy}`]
        }),
      )
      return { task: taskId, ...perArm }
    }),
  )
}

const { values } = parseArgs({
  options: {
    corpus: { type: 'string' },
    fff: { type: 'string' },
    out: { type: 'string' },
    report: { type: 'string' },
    arms: { type: 'string', default: 'baseline,fff,fff-only' },
    reps: { type: 'string', default: '2' },
    model: { type: 'string', default: 'sonnet' },
    parallel: { type: 'string', default: '3' },
    only: { type: 'string' },
  },
})

if (values.report !== undefined) {
  report(resolve(values.report))
  process.exit(0)
}

const Options = Schema.Struct({
  corpus: Schema.String,
  fff: Schema.String,
  out: Schema.String,
  arms: Schema.String,
  reps: Schema.NumberFromString.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  model: Schema.String,
  parallel: Schema.NumberFromString.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  only: Schema.optionalKey(Schema.String),
})
const parsedOptions = Schema.decodeUnknownSync(Options)(values)
const options = {
  ...parsedOptions,
  corpus: resolve(parsedOptions.corpus),
  fff: resolve(parsedOptions.fff),
  out: resolve(parsedOptions.out),
  arms: Schema.decodeUnknownSync(Schema.Array(ArmName))(parsedOptions.arms.split(',')),
}
const taskFile = ScriptJson.decodeJson(TaskFile, readFileSync(new URL('./fff-bench-tasks.json', import.meta.url), 'utf8'))
const tasks = taskFile.tasks.filter(task => options.only === undefined || task.id === options.only)
mkdirSync(options.out, { recursive: true })
const runsPath = join(options.out, 'runs.jsonl')
const done = new Set(
  existsSync(runsPath)
    ? readFileSync(runsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const record = ScriptJson.decodeJson(RunRecord, line)
          return `${record.task}.${record.arm}.${record.rep}`
        })
    : [],
)

// Interleave arms per task and rep so drift in API latency hits every arm alike.
const queue = Array.from({ length: options.reps }, (_, rep) => rep)
  .flatMap(rep => tasks.flatMap(task => options.arms.map(arm => ({ task, arm, rep }))))
  .filter(job => !done.has(`${job.task.id}.${job.arm}.${job.rep}`))

console.log(`${queue.length} runs on ${taskFile.corpus} with ${options.model}`)
const worker = async (): Promise<void> => {
  for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
    const record = await runOnce({ ...job, corpus: options.corpus, fffBinary: options.fff, model: options.model, scratch: join(options.out, 'runs') })
    appendFileSync(runsPath, `${JSON.stringify(record)}\n`)
    console.log(
      `${record.task} ${record.arm}#${record.rep}: ${record.ok ? 'ok' : 'FAIL'} score=${record.score.toFixed(2)} ${(record.wallMs / 1000).toFixed(0)}s ${record.turns}t $${record.costUsd.toFixed(3)} ${JSON.stringify(record.toolCalls)}`,
    )
  }
}
await Promise.all(Array.from({ length: options.parallel }, worker))
report(options.out)
