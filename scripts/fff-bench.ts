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
import { z } from 'zod'

const Task = z.object({
  id: z.string(),
  prompt: z.string(),
  expect: z.array(z.string()).optional(),
  recall: z.array(z.string()).optional(),
})
type Task = z.infer<typeof Task>
const TaskFile = z.object({ corpus: z.string(), tasks: z.array(Task) })

const AssistantEvent = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(z.looseObject({ type: z.string(), name: z.string().optional() })) }),
})
const ToolResultLength = z.union([
  z.string().transform(text => text.length),
  z.array(z.looseObject({ text: z.string().optional() })).transform(parts => parts.reduce((sum, part) => sum + (part.text?.length ?? 0), 0)),
])
const UserEvent = z.object({
  type: z.literal('user'),
  message: z.object({
    content: z.union([z.string(), z.array(z.looseObject({ type: z.string(), content: ToolResultLength.optional() }))]),
  }),
})
const ResultEvent = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string().optional(),
  duration_ms: z.number(),
  duration_api_ms: z.number(),
  num_turns: z.number(),
  total_cost_usd: z.number(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number(),
    cache_read_input_tokens: z.number(),
  }),
})
const StreamEvent = z.discriminatedUnion('type', [AssistantEvent, UserEvent, ResultEvent])

const RunRecord = z.object({
  task: z.string(),
  arm: z.string(),
  rep: z.number(),
  ok: z.boolean(),
  score: z.number(),
  wallMs: z.number(),
  sessionMs: z.number(),
  apiMs: z.number(),
  turns: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  toolResultChars: z.number(),
  toolCalls: z.record(z.string(), z.number()),
  answer: z.string(),
})
type RunRecord = z.infer<typeof RunRecord>

const fffHint = 'For any file search or grep in the current git-indexed directory, use fff tools.'
const answerRule = 'Answer from the repository only. End with one line starting `ANSWER:` that lists the repo-relative path(s) and any value asked for.'
const readOnlyBash = ['rg', 'fd', 'find', 'grep', 'ls', 'cat', 'head', 'tail', 'sed', 'wc'].map(command => `Bash(${command}:*)`)

const arms = {
  baseline: { tools: 'Read,Grep,Glob,Bash', allowed: ['Read', 'Grep', 'Glob', ...readOnlyBash], fff: false },
  fff: { tools: 'Read,Grep,Glob,Bash', allowed: ['Read', 'Grep', 'Glob', ...readOnlyBash, 'mcp__fff'], fff: true },
  'fff-only': { tools: 'Read', allowed: ['Read', 'mcp__fff'], fff: true },
} as const
const ArmName = z.enum(['baseline', 'fff', 'fff-only'])
type ArmName = z.infer<typeof ArmName>

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
  let result: z.infer<typeof ResultEvent> | undefined
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parsed = StreamEvent.safeParse(JSON.parse(line))
    if (!parsed.success) continue
    const event = parsed.data
    if (event.type === 'assistant') {
      for (const part of event.message.content) {
        if (part.type === 'tool_use' && part.name !== undefined) toolCalls[part.name] = (toolCalls[part.name] ?? 0) + 1
      }
    }
    if (event.type === 'user' && Array.isArray(event.message.content)) {
      for (const part of event.message.content) {
        if (part.type === 'tool_result') toolResultChars += part.content ?? 0
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
    .map(line => RunRecord.parse(JSON.parse(line)))
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

const Options = z.object({
  corpus: z.string().transform(path => resolve(path)),
  fff: z.string().transform(path => resolve(path)),
  out: z.string().transform(path => resolve(path)),
  arms: z.string().transform(list => z.array(ArmName).parse(list.split(','))),
  reps: z.coerce.number().int().positive(),
  model: z.string(),
  parallel: z.coerce.number().int().positive(),
  only: z.string().optional(),
})
const options = Options.parse(values)
const taskFile = TaskFile.parse(JSON.parse(readFileSync(new URL('./fff-bench-tasks.json', import.meta.url), 'utf8')))
const tasks = taskFile.tasks.filter(task => options.only === undefined || task.id === options.only)
mkdirSync(options.out, { recursive: true })
const runsPath = join(options.out, 'runs.jsonl')
const done = new Set(
  existsSync(runsPath)
    ? readFileSync(runsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const record = RunRecord.parse(JSON.parse(line))
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
