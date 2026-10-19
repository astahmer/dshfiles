#!/usr/bin/env node

/**
 * The DSH half of the fff search benchmark: runs each task of
 * `fff-bench-tasks.json` as a fresh session on a scratch DSH (`dshx dev up`)
 * with one pinned model, and appends rows that `fff-bench.ts --report` reads.
 * The arm is whatever the scratch profile currently loads (stock fs-search,
 * plus the fff MCP row, or fff-search instead of native grep/glob), so switch
 * the profile between arms and pass a matching `--arm` label.
 *
 *   DSHX_URL=<scratch launch url> node scripts/fff-bench-dsh.ts --corpus <dir> --arm <label> --out <dir>
 *     [--provider opencode-go-alex] [--model deepseek-v4.1-flash] [--effort high] [--reps 2] [--parallel 3] [--only <task-id>]
 */

import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { z } from 'zod'

const run = promisify(execFile)
const dshxBin = new URL('../tooling/dshx/packages/dshx/dist/cli/bin.js', import.meta.url).pathname
const turnTimeoutMs = 5 * 60_000
const answerRule = 'Answer from the repository only. End with one line starting `ANSWER:` that lists the repo-relative path(s) and any value asked for.'

const Task = z.object({
  id: z.string(),
  prompt: z.string(),
  expect: z.array(z.string()).optional(),
  recall: z.array(z.string()).optional(),
})
type Task = z.infer<typeof Task>
const TaskFile = z.object({ corpus: z.string(), tasks: z.array(Task) })

const Created = z.object({ data: z.object({ sessionId: z.string() }) })
const Digest = z.object({
  data: z.object({
    running: z.boolean(),
    lastTurnEnd: z.object({ kind: z.string() }).nullish(),
    lastAssistantText: z.object({ text: z.string() }).nullish(),
  }),
})
const SessionEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn/start'), time: z.number() }),
  z.object({ type: z.literal('turn/end'), time: z.number() }),
  z.object({
    type: z.literal('assistant/message'),
    data: z.object({
      usage: z
        .object({
          inputTokens: z.number().default(0),
          outputTokens: z.number().default(0),
          cacheReadTokens: z.number().default(0),
          cacheWriteTokens: z.number().default(0),
        })
        .optional(),
    }),
  }),
  z.object({ type: z.literal('tool/call'), data: z.object({ name: z.string() }) }),
  z.object({
    type: z.literal('tool/result'),
    data: z.object({
      message: z.object({
        content: z.array(z.looseObject({ text: z.string().optional() })).transform(parts => parts.reduce((sum, part) => sum + (part.text?.length ?? 0), 0)),
      }),
    }),
  }),
])
const Export = z.object({
  data: z.object({ records: z.array(z.looseObject({ event: z.looseObject({ type: z.string() }).optional() })) }),
})

const score = (task: Task, answer: string): number => {
  const haystack = answer.toLowerCase()
  if (task.recall !== undefined) {
    return task.recall.filter(needle => haystack.includes(needle.toLowerCase())).length / task.recall.length
  }
  return (task.expect ?? []).every(needle => haystack.includes(needle.toLowerCase())) ? 1 : 0
}

const dshx = async (args: string[]): Promise<string> => {
  const { stdout } = await run('fnm', ['exec', '--using=22.23.3', 'node', dshxBin, ...args], { maxBuffer: 256 << 20 })
  return stdout
}

const runOnce = async (options: { task: Task; arm: string; rep: number; corpus: string; provider: string; model: string; effort: string; rawDir: string }) => {
  const startedAt = performance.now()
  const sessionId = Created.parse(JSON.parse(await dshx(['sessions', 'create', '--cwd', options.corpus, '--json']))).data.sessionId
  await dshx(['models', 'select', '--session', sessionId, '--reasoning-effort', options.effort, options.provider, options.model])
  await dshx(['sessions', 'prompt', sessionId, `${options.task.prompt}\n\n${answerRule}`])

  let digest = Digest.parse(JSON.parse(await dshx(['sessions', 'digest', sessionId, '--json'])))
  while (digest.data.running || digest.data.lastTurnEnd == null) {
    if (performance.now() - startedAt > turnTimeoutMs) {
      await dshx(['sessions', 'cancel', sessionId])
      break
    }
    await new Promise(wake => setTimeout(wake, 2000))
    digest = Digest.parse(JSON.parse(await dshx(['sessions', 'digest', sessionId, '--json'])))
  }
  const wallMs = Math.round(performance.now() - startedAt)

  const exported = await dshx(['sessions', 'export', sessionId, '--json'])
  writeFileSync(join(options.rawDir, `${options.task.id}.${options.arm}.${options.rep}.json`), exported)
  const toolCalls: Record<string, number> = {}
  let toolResultChars = 0
  let turnStart = 0
  let turnEnd = 0
  let turns = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const record of Export.parse(JSON.parse(exported)).data.records) {
    const parsed = SessionEvent.safeParse(record.event)
    if (!parsed.success) continue
    const event = parsed.data
    if (event.type === 'turn/start' && turnStart === 0) turnStart = event.time
    if (event.type === 'turn/end') turnEnd = event.time
    if (event.type === 'tool/call') toolCalls[event.data.name] = (toolCalls[event.data.name] ?? 0) + 1
    if (event.type === 'tool/result') toolResultChars += event.data.message.content
    if (event.type === 'assistant/message') {
      turns += 1
      const usage = event.data.usage
      inputTokens += (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
      outputTokens += usage?.outputTokens ?? 0
    }
  }

  const answer = digest.data.lastAssistantText?.text ?? ''
  return {
    task: options.task.id,
    arm: options.arm,
    rep: options.rep,
    ok: digest.data.lastTurnEnd?.kind === 'completed',
    score: score(options.task, answer),
    wallMs,
    sessionMs: turnEnd > turnStart ? turnEnd - turnStart : 0,
    apiMs: 0,
    turns,
    inputTokens,
    outputTokens,
    costUsd: 0,
    toolResultChars,
    toolCalls,
    answer: answer
      .split('\n')
      .filter(line => line.includes('ANSWER:'))
      .join(' ')
      .slice(0, 400),
  }
}

const Options = z.object({
  corpus: z.string().transform(path => resolve(path)),
  arm: z.string().regex(/^[a-z0-9-]+$/),
  out: z.string().transform(path => resolve(path)),
  provider: z.string(),
  model: z.string(),
  effort: z.string(),
  reps: z.coerce.number().int().positive(),
  parallel: z.coerce.number().int().positive(),
  only: z.string().optional(),
})
const options = Options.parse(
  parseArgs({
    options: {
      corpus: { type: 'string' },
      arm: { type: 'string' },
      out: { type: 'string' },
      provider: { type: 'string', default: 'opencode-go-alex' },
      model: { type: 'string', default: 'deepseek-v4.1-flash' },
      effort: { type: 'string', default: 'high' },
      reps: { type: 'string', default: '2' },
      parallel: { type: 'string', default: '3' },
      only: { type: 'string' },
    },
  }).values,
)
if (process.env.DSHX_URL === undefined) throw new Error('Set DSHX_URL to the scratch DSH launch URL (dshx dev state.json).')

const taskFile = TaskFile.parse(JSON.parse(readFileSync(new URL('./fff-bench-tasks.json', import.meta.url), 'utf8')))
const tasks = taskFile.tasks.filter(task => options.only === undefined || task.id === options.only)
const rawDir = join(options.out, 'sessions')
mkdirSync(rawDir, { recursive: true })
const runsPath = join(options.out, 'runs.jsonl')
const done = new Set(
  existsSync(runsPath)
    ? readFileSync(runsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const record = z.object({ task: z.string(), arm: z.string(), rep: z.number() }).parse(JSON.parse(line))
          return `${record.task}.${record.arm}.${record.rep}`
        })
    : [],
)
const queue = Array.from({ length: options.reps }, (_, rep) => rep)
  .flatMap(rep => tasks.map(task => ({ task, rep })))
  .filter(job => !done.has(`${job.task.id}.${options.arm}.${job.rep}`))

console.log(`${queue.length} DSH runs (${options.arm}) on ${taskFile.corpus} with ${options.provider}/${options.model}`)
const worker = async (): Promise<void> => {
  for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
    const record = await runOnce({ ...job, ...options, rawDir })
    appendFileSync(runsPath, `${JSON.stringify(record)}\n`)
    console.log(
      `${record.task} ${record.arm}#${record.rep}: ${record.ok ? 'ok' : 'FAIL'} score=${record.score.toFixed(2)} ${(record.sessionMs / 1000).toFixed(0)}s ${record.turns}t ${JSON.stringify(record.toolCalls)}`,
    )
  }
}
await Promise.all(Array.from({ length: options.parallel }, worker))
