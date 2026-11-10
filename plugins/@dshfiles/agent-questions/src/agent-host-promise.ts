import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-questions'
import { HostContext } from '@dshfiles/dshx/effect'
import { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { NotificationFailed, ParentUnavailable } from './errors.js'
import { QuestionFacts, type SessionQuestionLoad, type SessionQuestionTarget } from './question-scan.js'
import { questionWaitProjectionDefinition } from './question-wait-projection.js'

/** The Agent object of a tool call: identity matters, so only the very Agent the Host runs counts as live. */
export interface LiveAgent {
  readonly id: string
}

const sessionIdOf = Schema.decodeUnknownOption(SessionId)

/** The session list of the Host could not be read. */
export class SessionListFailed extends Schema.TaggedError<SessionListFailed>()('SessionListFailed', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return 'The Host session list could not be read.'
  }
}

/**
 * Which Agents are live and how they are related, and the subagent messages that wake a parent or a child. This is
 * the only place the plugin reaches the Host's agents, sessions and subagents services.
 */
export class AgentDirectory extends Context.Service<
  AgentDirectory,
  {
    readonly isLive: (agent: LiveAgent) => boolean
    /** The live Agent object of a Session, when it runs now; the user answers from the Inbox as that Agent's principal. */
    readonly liveAgent: (sessionId: string) => LiveAgent | undefined
    readonly parentSessionId: (childSessionId: string) => string | undefined
    readonly isDirectChild: (childSessionId: string, parentSessionId: string) => boolean
    /** The workspace directory of a live Session, else the one its log recorded. */
    readonly workspaceOf: (sessionId: string) => Effect.Effect<string | undefined>
    readonly notifyParent: (input: {
      readonly childSessionId: string
      readonly parentSessionId: string
      readonly subject: 'question' | 'feedback'
      readonly text: string
    }) => Effect.Effect<string, ParentUnavailable | NotificationFailed>
    readonly notifyChild: (input: {
      readonly parentSessionId: string
      readonly childSessionId: string
      readonly text: string
    }) => Effect.Effect<void, ParentUnavailable | NotificationFailed>
  }
>()('@dshfiles/agent-questions/AgentDirectory') {
  static readonly layer = Layer.effect(
    AgentDirectory,
    Effect.gen(function* () {
      const host = yield* HostContext
      const context = host.ctx
      const agentOf = (sessionId: string): Agent | undefined =>
        Option.match(sessionIdOf(sessionId), { onNone: () => undefined, onSome: id => context.agents.get(id) })
      const send = (input: { readonly from: Agent; readonly to: Agent['id']; readonly text: string }) =>
        Effect.tryPromise({
          try: signal => context.subagents.sendMessage(input.from, input.to, [{ type: 'text', text: input.text }], { signal }),
          catch: cause => new NotificationFailed({ cause }),
        })
      return AgentDirectory.of({
        isLive: agent => agentOf(agent.id) === agent,
        liveAgent: sessionId => agentOf(sessionId),
        parentSessionId: childSessionId =>
          Option.getOrUndefined(Option.flatMapNullishOr(sessionIdOf(childSessionId), id => context.sessions.get(id)?.header.parentSession)),
        isDirectChild: (childSessionId, parentSessionId) => {
          const parent = agentOf(parentSessionId)
          return parent !== undefined && Option.exists(sessionIdOf(childSessionId), id => context.agents.isOwnedBy(id, parent))
        },
        workspaceOf: Effect.fn('agent questions workspace read')(function* (sessionId: string) {
          const id = sessionIdOf(sessionId)
          if (Option.isNone(id)) return undefined
          const live = context.sessions.get(id.value)?.header.cwd
          if (live !== undefined) return live
          return yield* Effect.acquireRelease(
            Effect.tryPromise(() => context.sessionQuery.observeSession(id.value)),
            observation => Effect.sync(() => observation[Symbol.dispose]()),
          ).pipe(
            Effect.map(observation => observation.header.cwd),
            Effect.scoped,
            Effect.orElseSucceed(() => undefined),
          )
        }),
        notifyParent: Effect.fn('agent questions parent notify')(function* (input) {
          const child = agentOf(input.childSessionId)
          const parent = agentOf(input.parentSessionId)
          if (child === undefined || parent === undefined || !context.agents.isOwnedBy(child.id, parent)) {
            return yield* new ParentUnavailable({ subject: input.subject })
          }
          return String(yield* send({ from: child, to: parent.id, text: input.text }))
        }),
        notifyChild: Effect.fn('agent questions child notify')(function* (input) {
          const parent = agentOf(input.parentSessionId)
          const childId = sessionIdOf(input.childSessionId)
          if (parent === undefined || Option.isNone(childId)) return yield* new ParentUnavailable({ subject: 'resolution' })
          yield* send({ from: parent, to: childId.value, text: input.text })
        }),
      })
    }),
  )
}

/**
 * The live Sessions as scan targets, without a persisted-corpus listing: a live Session cannot be stopped, so a caller
 * that excludes stopped Sessions needs nothing from storage. A live Session is persisted as it runs.
 */
const liveSessionTargets = (input: {
  readonly liveRoots: ReadonlySet<string>
  readonly sessions: ReadonlyArray<{ readonly id: string }>
}): ReadonlyArray<SessionQuestionTarget> =>
  input.sessions.map(session => {
    const sessionId = String(session.id)
    return { sessionId, sessionLive: true, sessionPersisted: true, targetIsLiveRoot: input.liveRoots.has(sessionId) }
  })

/**
 * Native `ask_user_question` forms across Sessions: which Sessions are live roots, the Session list to scan, one
 * Session's projected question facts, and the native answer API for continued forms.
 */
export class NativeQuestions extends Context.Service<
  NativeQuestions,
  {
    readonly liveRootIds: () => ReadonlySet<string>
    readonly isLiveRoot: (agent: LiveAgent) => boolean
    readonly listTargets: (input: {
      readonly liveRoots: ReadonlySet<string>
      readonly includeStopped: boolean
    }) => Effect.Effect<ReadonlyArray<SessionQuestionTarget>, SessionListFailed>
    readonly answer: (input: {
      readonly sessionId: string
      readonly callId: string
      readonly answer: AskUserQuestionAnswer
    }) => 'queued' | 'not-continued' | 'session-not-live' | 'target-not-root'
  }
>()('@dshfiles/agent-questions/NativeQuestions') {
  static readonly layer = Layer.effect(
    NativeQuestions,
    Effect.gen(function* () {
      const host = yield* HostContext
      const context = host.ctx
      yield* Effect.acquireRelease(
        Effect.sync(() => context.sessionProjections.register(questionWaitProjectionDefinition)),
        unregister => Effect.sync(() => (typeof unregister === 'function' ? unregister() : undefined)),
      )
      const liveRootIds = () => new Set(context.agents.roots().map(agent => String(agent.id)))
      return NativeQuestions.of({
        liveRootIds,
        isLiveRoot: agent => Option.exists(sessionIdOf(agent.id), id => context.agents.get(id) === agent) && liveRootIds().has(agent.id),
        listTargets: Effect.fn('agent questions sessions list')(function* (input) {
          if (!input.includeStopped) return liveSessionTargets({ liveRoots: input.liveRoots, sessions: context.sessions.list() })
          const sessions = yield* Effect.tryPromise({
            try: signal => context.sessionQuery.listSessions(signal),
            catch: cause => new SessionListFailed({ cause }),
          })
          return sessions
            .filter(session => input.includeStopped || session.live)
            .map(session => ({
              sessionId: String(session.header.id),
              sessionLive: session.live,
              sessionPersisted: session.persisted,
              targetIsLiveRoot: session.live && input.liveRoots.has(String(session.header.id)),
            }))
        }),
        answer: input => {
          const targetAgent = Option.getOrUndefined(Option.flatMapNullishOr(sessionIdOf(input.sessionId), id => context.agents.get(id)))
          if (targetAgent === undefined) return 'session-not-live'
          if (!liveRootIds().has(String(targetAgent.id))) return 'target-not-root'
          return context.userQuestions.answer(targetAgent, ToolCallId(input.callId), input.answer) ? 'queued' : 'not-continued'
        },
      })
    }),
  )
}

const unavailable: SessionQuestionLoad = { projectionUnavailable: true }

/** One Session's native question facts, read from its projection on the Host; a failed read is reported, not thrown. */
export const QuestionFactsLive = Layer.effect(
  QuestionFacts,
  Effect.gen(function* () {
    const host = yield* HostContext
    const context = host.ctx
    return QuestionFacts.of({
      load: Effect.fn('agent questions facts load')(function* (target: SessionQuestionTarget) {
        const id = sessionIdOf(target.sessionId)
        if (Option.isNone(id)) return unavailable
        return yield* Effect.acquireRelease(
          Effect.tryPromise(signal => context.sessionQuery.observeSession(id.value, { signal, projectionMode: 'all' })),
          observation => Effect.sync(() => observation[Symbol.dispose]()),
        ).pipe(
          Effect.map((observation): SessionQuestionLoad => {
            const questionView = observation.projections?.values.userQuestions
            if (questionView === undefined) return unavailable
            return {
              facts: { pending: questionView.active, waits: observation.projections?.values.dshfilesQuestionWaits?.active ?? [] },
              projectionUnavailable: false,
            }
          }),
          Effect.scoped,
          Effect.orElseSucceed(() => unavailable),
        )
      }),
    })
  }),
)
