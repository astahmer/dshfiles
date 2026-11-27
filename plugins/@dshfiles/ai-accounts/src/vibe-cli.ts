import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import * as Schema from 'effect/Schema'
import { CliBridge } from './cli-bridge.js'
import { AiAccountsSchema } from './effect-schema.js'
import { VibeAccountModel } from './vibe-account.js'

/**
 * Mistral Vibe through the official `vibe` CLI instead of the Mistral API.
 *
 * A Mistral plan bills two included buckets: the API credit, which a plain API-key request draws, and the Vibe &
 * Studio allowance, which only the CLI itself draws. This route runs one `vibe --prompt-file … --output streaming`
 * process per DSH step in the account's own VIBE_HOME, so the signed-in session `vibe --setup` stored is the one that
 * pays. It is a CLI-agent route: the CLI owns its agent loop and its own tools, and this bridge neither exposes DSH's
 * tools to it nor runs tool calls back. Each step replays the transcript as text, streams the answer (and its
 * reasoning) as it arrives, and reads tokens, cost and the failure text from the `export.json` Vibe writes on exit.
 */

const IDLE_TIMEOUT_MS = 10 * 60_000
/** Headless steps bound their own work: the route replays the transcript and gets one answer per DSH step. */
const MAX_TURNS = 4

const contentBlockSchema = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })

const vibeEntrySchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('message'),
    role: Schema.optionalKey(Schema.String),
    content: Schema.optionalKey(Schema.Array(contentBlockSchema)),
  }),
  Schema.Struct({ type: Schema.Literal('reasoning'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('effect'),
    detail: Schema.optionalKey(Schema.Struct({ kind: Schema.optionalKey(Schema.String), toolName: Schema.optionalKey(Schema.String) })),
  }),
  Schema.Struct({ type: Schema.Literal('callback') }),
  Schema.Struct({ type: Schema.Literal('checkpoint') }),
  Schema.Struct({ type: Schema.Literal('notice') }),
])
type VibeEntry = typeof vibeEntrySchema.Type

const usageSchema = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Number),
  output_tokens: Schema.optionalKey(Schema.Number),
  cached_input_tokens: Schema.optionalKey(Schema.Number),
})
const exportSchema = Schema.Struct({
  outcome: Schema.optionalKey(Schema.NullOr(Schema.String)),
  stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.String }))),
  usage: Schema.optionalKey(Schema.NullOr(usageSchema)),
  cost_usd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
})
type VibeExport = typeof exportSchema.Type

const whole = (value: number | undefined): number => (value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.trunc(value)))

/** `--thinking` for a pi-ai level, when the model's own catalog lists it. */
const thinkingFor = (model: Model<string>, reasoning: SimpleStreamOptions['reasoning']): string | undefined => {
  if (reasoning === undefined) return undefined
  const level = reasoning === 'minimal' ? 'low' : reasoning
  const wire = model.thinkingLevelMap?.[level]
  return typeof wire === 'string' && wire !== '' ? wire : undefined
}

const stderrTail = (text: string): string => text.trim().split(/\r?\n/u).slice(-8).join('\n').slice(0, 4_000)

/**
 * One `vibe` process drives exactly one DSH step. The CLI keeps session continuity (`--resume`) only for its own
 * interactive use; here every step replays the transcript, so a step always sees the conversation DSH holds.
 */
export class VibeCliSessions {
  private readonly running = new Set<ChildProcessByStdio<null, Readable, Readable>>()

  constructor(
    private readonly options: {
      /** The account's VIBE_HOME, where the CLI login and its config live. */
      readonly home: (provider: string) => string
      readonly executable?: string
      readonly idleTimeoutMs?: number
      readonly maxTurns?: number
    },
  ) {}

  dispose(): void {
    for (const child of this.running) child.kill()
    this.running.clear()
  }

  /** Stream one DSH model step through `vibe --output streaming`. */
  stream(model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream()
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    const fail = (reason: 'error' | 'aborted', message: string): void => {
      output.stopReason = reason
      output.errorMessage = message
      stream.push({ type: 'error', reason, error: output })
      stream.end(output)
    }
    try {
      this.run({ model, context, streamOptions, stream, output, fail })
    } catch (error) {
      fail('error', `Mistral Vibe CLI: ${error instanceof Error ? error.message : String(error)}`)
    }
    return stream
  }

  private run(input: {
    readonly model: Model<string>
    readonly context: TranscriptContext
    readonly streamOptions: SimpleStreamOptions | undefined
    readonly stream: AssistantMessageEventStream
    readonly output: AssistantMessage
    readonly fail: (reason: 'error' | 'aborted', message: string) => void
  }): void {
    const { model, context, streamOptions, stream, output, fail } = input
    const home = VibeAccountModel.resolveHome(this.options.home(model.provider))
    const directory = mkdtempSync(join(tmpdir(), 'dsh-vibe-'))
    const workdir = join(directory, 'workspace')
    const outputDir = join(directory, 'export')
    mkdirSync(workdir)
    mkdirSync(outputDir)
    const cleanup = (): void => rmSync(directory, { recursive: true, force: true })

    const messages = context.messages.filter(message => message.role !== 'system')
    const promptPath = join(directory, 'prompt.md')
    const transcript = CliBridge.renderTranscript(messages)
    writeFileSync(promptPath, transcript === '' ? 'Continue from where the conversation stopped.' : transcript, 'utf8')

    const system = getCurrentSystemPrompt(context.messages)
    const systemPath = join(directory, 'system.md')
    writeFileSync(
      systemPath,
      `${system ?? 'You are answering inside DeepSeek Harness.'}\n\nThis route runs you as a CLI agent without tools: answer from the conversation above and what you already know. You cannot read or change files, run commands, or browse from here.`,
      'utf8',
    )

    const args = [
      '--prompt-file',
      promptPath,
      '--output',
      'streaming',
      '--output-dir',
      outputDir,
      '--workdir',
      workdir,
      '--trust',
      '--system-prompt-file',
      systemPath,
      // A headless turn has no user to ask, so an unapproved tool is denied. Write access never reaches the project.
      '--approval-policy',
      'ask',
      '--max-turns',
      String(this.options.maxTurns ?? MAX_TURNS),
      '--model',
      VibeAccountModel.canonicalModelId(model.id),
    ]
    const thinking = thinkingFor(model, streamOptions?.reasoning)
    if (thinking !== undefined) args.push('--thinking', thinking)

    // The CLI reads the variable before its own login, so an inherited key would bill the API credit. Its `.env` and
    // keyring stay untouched: those are the signed-in session this route exists for.
    const env: NodeJS.ProcessEnv = { ...process.env, VIBE_HOME: home }
    delete env['MISTRAL_API_KEY']
    delete env['VIBE_CWD']

    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn(this.options.executable ?? 'vibe', args, { cwd: workdir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (cause) {
      cleanup()
      fail(
        'error',
        `Mistral Vibe CLI could not start: ${cause instanceof Error ? cause.message : String(cause)}. Install it and run \`vibe --setup\`, then retry.`,
      )
      return
    }
    this.running.add(child)

    let stderr = ''
    let textIndex: number | undefined
    let thinkingIndex: number | undefined
    let finished = false

    stream.push({ type: 'start', partial: output })

    const idleTimeoutMs = this.options.idleTimeoutMs ?? IDLE_TIMEOUT_MS
    let idle = setTimeout(onIdle, idleTimeoutMs)
    idle.unref()

    const closeBlocks = (): void => {
      if (textIndex !== undefined) {
        const block = output.content[textIndex]
        if (block?.type === 'text') stream.push({ type: 'text_end', contentIndex: textIndex, content: block.text, partial: output })
      }
      if (thinkingIndex !== undefined) {
        const block = output.content[thinkingIndex]
        if (block?.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: thinkingIndex, content: block.thinking, partial: output })
      }
    }

    const finish = (): void => {
      if (finished) return
      finished = true
      clearTimeout(idle)
      streamOptions?.signal?.removeEventListener('abort', onAbort)
      this.running.delete(child)
    }

    function onIdle(): void {
      if (finished) return
      finish()
      child.kill()
      cleanup()
      fail(
        'error',
        `vibe wrote nothing for ${String(Math.round(idleTimeoutMs / 60_000))} minutes and was stopped. Retry, or pick a smaller model; the Vibe CLI keeps its own log under VIBE_HOME/logs.`,
      )
    }

    const onAbort = (): void => {
      if (finished) return
      finish()
      child.kill()
      cleanup()
      fail('aborted', 'Request was aborted')
    }
    streamOptions?.signal?.addEventListener('abort', onAbort, { once: true })

    const touch = (): void => {
      clearTimeout(idle)
      idle = setTimeout(onIdle, idleTimeoutMs)
      idle.unref()
    }

    const appendText = (text: string): void => {
      if (text === '') return
      if (textIndex === undefined) {
        textIndex = output.content.push({ type: 'text', text: '' }) - 1
        stream.push({ type: 'text_start', contentIndex: textIndex, partial: output })
      }
      const block = output.content[textIndex]
      if (block?.type !== 'text') return
      block.text += text
      stream.push({ type: 'text_delta', contentIndex: textIndex, delta: text, partial: output })
    }

    const appendThinking = (text: string): void => {
      if (text === '') return
      if (thinkingIndex === undefined) {
        thinkingIndex = output.content.push({ type: 'thinking', thinking: '' }) - 1
        stream.push({ type: 'thinking_start', contentIndex: thinkingIndex, partial: output })
      }
      const block = output.content[thinkingIndex]
      if (block?.type !== 'thinking') return
      block.thinking += text
      stream.push({ type: 'thinking_delta', contentIndex: thinkingIndex, delta: text, partial: output })
    }

    const handleEntry = (entry: VibeEntry): void => {
      if (entry.type === 'message') {
        if (entry.role !== undefined && entry.role !== 'assistant') return
        for (const block of entry.content ?? []) if (block.type === 'text' && block.text !== undefined) appendText(block.text)
        return
      }
      if (entry.type === 'reasoning') appendThinking(entry.text)
      // `effect` is a tool call the CLI ran (or denied) itself; this route does not bridge DSH tools, so it stays out
      // of the DSH transcript. `callback`, `checkpoint` and `notice` carry no answer text.
    }

    const finishWithExport = (): void => {
      const readExport = (): VibeExport | null => {
        try {
          const decoded = AiAccountsSchema.decodeResult(exportSchema, JSON.parse(readFileSync(join(outputDir, 'export.json'), 'utf8')))
          return decoded._tag === 'Success' ? decoded.success : null
        } catch {
          return null
        }
      }
      const exported = readExport()
      const usage = exported?.usage ?? null
      if (usage !== null) {
        const input = whole(usage.input_tokens)
        const produced = whole(usage.output_tokens)
        const cacheRead = whole(usage.cached_input_tokens)
        output.usage = {
          ...output.usage,
          input,
          output: produced,
          cacheRead,
          totalTokens: input + produced + cacheRead,
        }
      }
      const cost = exported?.cost_usd
      if (cost !== undefined && cost !== null && Number.isFinite(cost) && cost > 0) output.usage.cost.total = cost
      const failure = exported?.error ?? null
      const stopReason = exported?.stop_reason ?? null
      if (failure !== null && failure.message !== '') {
        closeBlocks()
        cleanup()
        fail('error', failure.message.slice(0, 4_000))
        return
      }
      if (stopReason !== null && stopReason !== '') output.rawStopReason = stopReason
      closeBlocks()
      cleanup()
      stream.push({
        type: 'done',
        reason: stopReason === 'max_tokens' || stopReason === 'max_output_tokens' || stopReason === 'max_turns' ? 'length' : 'stop',
        message: output,
      })
      stream.end(output)
    }

    const onExit = (code: number | null): void => {
      if (finished) return
      const reason =
        code === 0
          ? null
          : stderrTail(stderr) || `vibe exited with code ${String(code)}. Check the Vibe CLI's own log under VIBE_HOME/logs, or run \`vibe --setup\` again.`
      finish()
      if (reason !== null) {
        closeBlocks()
        cleanup()
        fail('error', reason)
        return
      }
      finishWithExport()
    }

    child.stdout.setEncoding('utf8')
    createInterface({ input: child.stdout }).on('line', line => {
      touch()
      const trimmed = line.trim()
      if (trimmed === '') return
      const decoded = AiAccountsSchema.decodeResult(Schema.fromJsonString(vibeEntrySchema), trimmed)
      if (decoded._tag === 'Success') handleEntry(decoded.success)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      touch()
      if (stderr.length < 16_000) stderr += chunk
    })
    child.on('error', error => {
      if (finished) return
      finish()
      cleanup()
      fail('error', `Mistral Vibe CLI could not start (${error.message}). Install \`vibe\`, run \`vibe --setup\`, then retry.`)
    })
    child.on('close', onExit)
  }
}

/** Placeholder credential for pi-ai: `vibe` authenticates with its own login, so the route never sends an HTTP token. */
export const VIBE_CLI_TOKEN = 'vibe-cli-login'
