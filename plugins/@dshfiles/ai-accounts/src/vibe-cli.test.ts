import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Model } from '@earendil-works/pi-ai'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it } from 'vitest'
import { AiAccountsSchema } from './effect-schema.js'
import { VibeCliSessions } from './vibe-cli.js'

/**
 * Stands in for `vibe --prompt-file … --output streaming`: writes one completed history entry per JSON line (a user
 * echo, reasoning, a tool effect and the assistant answer) and the `export.json` Vibe writes on every exit.
 */
const FAKE_VIBE = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const prompt = fs.readFileSync(arg('--prompt-file'), 'utf8')
const system = arg('--system-prompt-file') === null ? null : fs.readFileSync(arg('--system-prompt-file'), 'utf8')
const report = {
  model: arg('--model'),
  thinking: args.includes('--thinking') ? arg('--thinking') : null,
  approval: arg('--approval-policy'),
  maxTurns: arg('--max-turns'),
  workdir: arg('--workdir'),
  home: process.env.VIBE_HOME ?? null,
  inheritedKey: process.env.MISTRAL_API_KEY ?? null,
  system,
  prompt,
}
const say = value => process.stdout.write(JSON.stringify(value) + '\\n')
say({ type: 'message', role: 'user', id: 'u1', content: [{ type: 'text', text: prompt.slice(0, 40) }] })
say({ type: 'reasoning', id: 'r1', text: 'weighing the options' })
say({ type: 'effect', id: 'e1', detail: { toolName: 'read_file' }, state: { status: 'failed' } })
say({ type: 'notice', id: 'n1' })
say({ type: 'message', role: 'assistant', id: 'a1', content: [{ type: 'text', text: 'ok ' + JSON.stringify(report) }] })
fs.writeFileSync(path.join(arg('--output-dir'), 'export.json'), JSON.stringify({
  outcome: 'finished',
  stop_reason: null,
  error: null,
  session_id: 'synthetic-session',
  usage: { input_tokens: 10, output_tokens: 3, cached_input_tokens: 2, total_tokens: 15 },
  cost_usd: 0.25,
}))
`

const FAILING_VIBE = `#!/usr/bin/env node
process.stderr.write('error: unknown model alias "nope"\\n')
process.exit(1)
`

const directories: string[] = []
const sessions: VibeCliSessions[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'vibe-cli-'))
  directories.push(directory)
  return directory
}

const executableWith = (source: string): string => {
  const path = join(temporary(), 'vibe')
  writeFileSync(path, source)
  chmodSync(path, 0o755)
  return path
}

const model: Model<string> = {
  id: 'deepseek-v4-1-flash-1017',
  name: 'DeepSeek V4.1 Flash',
  api: 'vibe-cli',
  provider: 'vibe_work',
  baseUrl: '',
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_048_576,
  maxTokens: 131_072,
  reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
}

/** The report the fake prints, decoded once at the test boundary instead of asserted off raw JSON. */
const reportSchema = Schema.Struct({
  model: Schema.String,
  thinking: Schema.NullOr(Schema.String),
  approval: Schema.String,
  maxTurns: Schema.String,
  workdir: Schema.String,
  home: Schema.NullOr(Schema.String),
  inheritedKey: Schema.NullOr(Schema.String),
  system: Schema.NullOr(Schema.String),
  prompt: Schema.String,
})

const reportOf = (message: AssistantMessage) => {
  const decoded = AiAccountsSchema.decodeResult(Schema.fromJsonString(reportSchema), textOf(message).replace(/^ok /u, ''))
  if (decoded._tag !== 'Success') throw new Error('the fake vibe report did not decode')
  return decoded.success
}

const finished = async (stream: AssistantMessageEventStream): Promise<AssistantMessage> => {
  for await (const event of stream) {
    if (event.type === 'done') return event.message
    if (event.type === 'error') throw new Error(event.error.errorMessage)
  }
  throw new Error('stream ended without a result')
}

const textOf = (message: AssistantMessage): string => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

const context = normalizeContext({
  systemPrompt: 'Synthetic system prompt.',
  messages: [
    { role: 'user', content: 'first question', timestamp: 1 },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'first answer' }],
      api: 'vibe-cli',
      provider: 'vibe_work',
      model: 'deepseek-v4-1-flash-1017',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 2,
    },
    { role: 'user', content: 'second question', timestamp: 3 },
  ],
})

describe('the Vibe CLI route', () => {
  it('streams the answer and its reasoning, never a tool call, and reads tokens and cost from export.json', async () => {
    const home = join(temporary(), 'vibe-home')
    const cli = new VibeCliSessions({ home: () => home, executable: executableWith(FAKE_VIBE) })
    sessions.push(cli)
    const message = await finished(cli.stream(model, context, { reasoning: 'high', sessionId: 'synthetic' }))
    const payload = reportOf(message)

    expect(message.content.map(block => block.type)).toEqual(['thinking', 'text'])
    expect(message.content[0]).toMatchObject({ type: 'thinking', thinking: 'weighing the options' })
    expect(payload.model).toBe('deepseek-v4-1-flash-1017')
    expect(payload.thinking).toBe('high')
    expect(payload.approval).toBe('ask')
    expect(payload.maxTurns).toBe('4')
    expect(payload.home).toBe(home)
    expect(String(payload.workdir)).toContain('dsh-vibe-')
    expect(payload.system).toContain('Synthetic system prompt.')
    expect(payload.system).toContain('runs you as a CLI agent without tools')
    expect(payload.prompt).toContain('<user>\nfirst question\n</user>')
    expect(payload.prompt).toContain('<assistant>\nfirst answer\n</assistant>')
    expect(payload.prompt).toContain('<user>\nsecond question\n</user>')
    expect(message.usage).toMatchObject({ input: 10, output: 3, cacheRead: 2, totalTokens: 15 })
    expect(message.usage.cost.total).toBe(0.25)
    expect(message.stopReason).toBe('stop')
  })

  it('drops an inherited MISTRAL_API_KEY so the CLI login is what pays', async () => {
    const previous = process.env['MISTRAL_API_KEY']
    process.env['MISTRAL_API_KEY'] = 'synthetic-inherited-key'
    try {
      const cli = new VibeCliSessions({ home: () => join(temporary(), 'vibe-home'), executable: executableWith(FAKE_VIBE) })
      sessions.push(cli)
      const payload = reportOf(await finished(cli.stream(model, context, undefined)))
      expect(payload.inheritedKey).toBeNull()
    } finally {
      if (previous === undefined) delete process.env['MISTRAL_API_KEY']
      else process.env['MISTRAL_API_KEY'] = previous
    }
  })

  it('reports a rejected model with the CLI stderr, so the recovery names the alias', async () => {
    const cli = new VibeCliSessions({ home: () => join(temporary(), 'vibe-home'), executable: executableWith(FAILING_VIBE) })
    sessions.push(cli)
    await expect(finished(cli.stream(model, context, undefined))).rejects.toThrow('unknown model alias "nope"')
  })

  it('names the install and sign-in recovery when the CLI is missing', async () => {
    const cli = new VibeCliSessions({ home: () => join(temporary(), 'vibe-home'), executable: join(temporary(), 'missing-vibe') })
    sessions.push(cli)
    await expect(finished(cli.stream(model, context, undefined))).rejects.toThrow(/vibe --setup/u)
  })

  it('stops a process that writes nothing and says the CLI log is where the detail lives', async () => {
    const silent = executableWith(`#!/usr/bin/env node\nsetInterval(() => {}, 1000)\n`)
    const cli = new VibeCliSessions({ home: () => join(temporary(), 'vibe-home'), executable: silent, idleTimeoutMs: 100 })
    sessions.push(cli)
    await expect(finished(cli.stream(model, context, undefined))).rejects.toThrow(/wrote nothing/u)
  })
})
