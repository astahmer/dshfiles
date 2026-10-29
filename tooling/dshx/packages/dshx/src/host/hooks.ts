import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { LlmCallConfig, LlmFailure, ResolvedRetryPolicy, UserMessage } from '@deepseek-ai/dsh-llm'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

type Maybe<T> = T | undefined | Promise<T | undefined>

/** What `approval/request` carries; dsh-user-approval exports the event only through its Events augmentation. */
type ApprovalRequestEvent = Parameters<Events['approval/request']>[0]

/** A shell environment contributor: variables every `bash` call of an agent gets. */
export interface ShellEnvHook {
  readonly name: string
  readonly variables: Readonly<Record<string, { readonly description: string }>>
  resolve(execution: ToolExecution): Readonly<Record<string, string>>
}

/**
 * Typed hooks over DSH's own middleware. Each one runs in DSH's chain for that point: returning `undefined` leaves
 * the decision to the rest of the chain, a throwing hook is logged and treated as `undefined`. Every hook ends with
 * the plugin.
 */
export interface HostHooks {
  /** Before a step starts (`agent/pre-step`): replace the queued messages it admits, or hold the step without asking later listeners. */
  readonly promptAdmission?: (input: {
    readonly agent: Agent
    readonly messages: readonly UserMessage[]
    readonly turn: number
    readonly step: number
  }) => Maybe<{ readonly messages: readonly UserMessage[] } | 'reject'>
  /** Each agent model request (`agent/request`): change provider, model or call controls. */
  readonly request?: (input: {
    readonly agent: Agent
    readonly turn: number
    readonly step: number
    readonly config: Readonly<LlmCallConfig>
  }) => Maybe<Partial<LlmCallConfig>>
  /** Each system-prompt assembly (`system-prompt/assemble`): sections, contexts and tool schemas. */
  readonly systemPrompt?: (input: { readonly agent: Agent | undefined; readonly assembly: PromptAssembly }) => Maybe<PromptAssembly>
  /** A failed agent request (`agent/request-error`): retry it, or stop retrying. */
  readonly retry?: (input: {
    readonly agent: Agent
    readonly provider: string
    readonly failure: LlmFailure
    readonly policy: ResolvedRetryPolicy | undefined
  }) => Maybe<'retry' | 'stop'>
  /** A tool call asking the user's approval (`approval/request`): answer for the user. */
  readonly permission?: (request: ApprovalRequestEvent) => Maybe<ApprovalOutcome>
  /** Before a tool runs (`tools/pre-execute`): allow, deny, cancel or ask. */
  readonly toolBefore?: (execution: ToolExecution) => Maybe<PreToolDecision>
  /** After a tool ran (`tools/post-execute`): replace its content or value, or block it with feedback. */
  readonly toolAfter?: (execution: ToolExecution, result: Readonly<ToolExecutionResult>) => Maybe<PostToolDecision>
  /** Environment variables for agent shell commands (`shellEnv.register`). */
  readonly shellEnv?: ShellEnvHook
  /** Every authenticated raw HTTP request under `/api` (`connection/request`), before Connection routes it; true when answered. */
  readonly http?: (request: IncomingMessage, response: ServerResponse) => boolean | Promise<boolean>
}

/** The Cordis services a definition's hooks need, for its `inject`; a hooks factory declares its own. */
const servicesFor = (hooks: HostHooks | ((ctx: Context) => HostHooks) | undefined): string[] => {
  if (hooks === undefined || typeof hooks === 'function') return []
  const services = [
    hooks.promptAdmission !== undefined || hooks.request !== undefined || hooks.retry !== undefined ? 'agents' : undefined,
    hooks.systemPrompt === undefined ? undefined : 'systemPrompt',
    hooks.toolBefore !== undefined || hooks.toolAfter !== undefined ? 'tools' : undefined,
    hooks.shellEnv === undefined ? undefined : 'shellEnv',
    hooks.http === undefined ? undefined : 'connection',
  ]
  return services.filter(service => service !== undefined)
}

interface ShellEnvLike {
  register(contributor: ShellEnvHook): () => void
}

const install = (ctx: Context, packageId: string, hooks: HostHooks): void => {
  /** A hook that throws has no opinion: the rest of the chain decides. */
  const safely = async <T>(hook: string, run: () => Maybe<T>): Promise<T | undefined> => {
    try {
      return await run()
    } catch (cause) {
      ctx.logger('dshx:hooks').warn(`${packageId}: hook ${hook} failed and was skipped: ${cause instanceof Error ? cause.message : String(cause)}`)
      return undefined
    }
  }
  const { promptAdmission, request, systemPrompt, retry, permission, toolBefore, toolAfter, shellEnv, http } = hooks
  if (promptAdmission !== undefined) {
    ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
      // Asked before the rest of the chain, so a hook that holds the step never lets later listeners run.
      const answer = await safely('promptAdmission', () =>
        promptAdmission({ agent: payload.agent, messages: payload.messages, turn: payload.turn, step: payload.step }),
      )
      if (answer === 'reject') return { kind: 'reject' }
      const decision = await next()
      if (answer === undefined || decision.kind === 'reject') return decision
      return { ...decision, messages: [...answer.messages] }
    })
  }
  if (request !== undefined) {
    ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
      const config = await next()
      const patch = await safely('request', () => request({ agent: payload.agent, turn: payload.turn, step: payload.step, config }))
      return patch === undefined ? config : { ...config, ...patch }
    })
  }
  if (systemPrompt !== undefined) {
    ctx.on('system-prompt/assemble', async (assembly, context, next): Promise<PromptAssembly> => {
      const assembled = await next()
      return (await safely('systemPrompt', () => systemPrompt({ agent: context.agent, assembly: assembled }))) ?? assembled
    })
  }
  if (retry !== undefined) {
    ctx.on('agent/request-error', async (payload, next): Promise<RequestErrorAction> => {
      const action = await next()
      const answer = await safely('retry', () =>
        retry({ agent: payload.agent, provider: payload.provider, failure: payload.failure, policy: payload.retryPolicy }),
      )
      if (answer === 'retry') return { kind: 'retry' }
      if (answer === 'stop') return undefined
      return action
    })
  }
  if (permission !== undefined) {
    ctx.on('approval/request', async (event, next): Promise<ApprovalOutcome> => (await safely('permission', () => permission(event))) ?? next())
  }
  if (toolBefore !== undefined) {
    ctx.on('tools/pre-execute', async (execution, next): Promise<PreToolDecision> => (await safely('toolBefore', () => toolBefore(execution))) ?? next())
  }
  if (toolAfter !== undefined) {
    ctx.on('tools/post-execute', async (execution, result, next): Promise<PostToolDecision> => {
      const decision = await next()
      if (decision.kind === 'block') return decision
      return (await safely('toolAfter', () => toolAfter(execution, result))) ?? decision
    })
  }
  if (shellEnv !== undefined) {
    // SAFETY: `shellEnv` is DSH's ShellEnvRegistry (@deepseek-ai/dsh-shell-env), injected for this hook; dshx reads its register method only.
    ctx.effect(() => (ctx.get('shellEnv') as ShellEnvLike).register(shellEnv), `${packageId}: shell environment`)
  }
  if (http !== undefined) {
    ctx.on('connection/request', async (incoming, response, next) => {
      if ((await safely('http', () => http(incoming, response))) === true) return
      await next()
    })
  }
}

export class HostHooksModel {
  static readonly servicesFor = servicesFor
  static readonly install = install
}
