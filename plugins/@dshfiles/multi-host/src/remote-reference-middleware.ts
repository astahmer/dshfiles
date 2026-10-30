import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionReferenceInput } from '@deepseek-ai/dsh-session-reference/types'
import type { SessionSourceRegistry } from '@dshfiles/session-source-port'
import { authorizeRemoteSessionRuntime } from './session-runtime-authorization.js'
import { RemoteReferenceContext } from './remote-reference-context.js'

export type RemoteReferenceSnapshot = { readonly cursor: number; readonly records: readonly unknown[] }

export const registerRemoteReferenceMiddleware = (input: {
  readonly ctx: Context
  readonly recordedThreads: () => Promise<readonly { readonly sessionId: string; readonly runtimeId: string }[]>
  readonly sessionSources: () => readonly SessionSourceRegistry[]
  readonly follow: (input: {
    readonly runtimeId: string
    readonly sessionId: string
    readonly maxMessages: number
    readonly signal: AbortSignal
  }) => Promise<RemoteReferenceSnapshot | undefined>
}) =>
  input.ctx.on(
    'agent/pre-step',
    async ({ agent, messages, signal }, next) => {
      if (
        !messages.some(message => message.source.kind === 'user' && message.content.some(block => block.type === 'text' && block.text.includes('dsh-session:')))
      )
        return next()
      const recordedThreads = await input.recordedThreads()
      if (recordedThreads.length === 0 || signal.aborted) return next()
      const recordedBySession = new Map(recordedThreads.map(thread => [thread.sessionId, thread]))
      const remoteSessionIds = new Set([...recordedBySession.keys()].filter(sessionId => sessionId !== agent.id))
      const remoteReferences: { readonly reference: SessionReferenceInput; readonly runtimeId: string }[] = []
      const replacements = new Map<object, readonly ContentBlock[]>()

      for (const message of messages) {
        if (message.source.kind !== 'user') continue
        const nextContent: ContentBlock[] = []
        let messageChanged = false
        for (const block of message.content) {
          if (block.type !== 'text') {
            nextContent.push(block)
            continue
          }
          const redacted = RemoteReferenceContext.redactRemoteReferenceMentions(block.text, remoteSessionIds)
          if (redacted === undefined) {
            nextContent.push(block)
            continue
          }
          const targets = redacted.references.flatMap(reference => {
            const recorded = recordedBySession.get(reference.sessionId)
            return recorded === undefined || reference.sessionId === agent.id ? [] : [{ reference, runtimeId: recorded.runtimeId }]
          })
          if (targets.length === 0) {
            nextContent.push(block)
            continue
          }
          messageChanged = true
          nextContent.push({ ...block, text: redacted.text })
          for (const target of targets) remoteReferences.push(target)
        }
        if (messageChanged) replacements.set(message, nextContent)
      }

      const uniqueReferences = [...new Map(remoteReferences.map(item => [item.reference.sessionId, item])).values()]
      if (uniqueReferences.length === 0 || uniqueReferences.length > 3) return next()

      const contexts = await RemoteReferenceContext.withRemoteReferenceSpan({
        referenceCount: uniqueReferences.length,
        work: () =>
          Promise.all(
            uniqueReferences.map(async ({ reference, runtimeId }) => {
              const authorization = await authorizeRemoteSessionRuntime({
                sessionId: reference.sessionId,
                runtimeId,
                recordedSessions: recordedThreads,
                sessionSources: input.sessionSources(),
              })
              if (!authorization.ok) throw new Error('Remote reference authorization failed.')
              const snapshot = await input.follow({
                runtimeId,
                sessionId: reference.sessionId,
                maxMessages: RemoteReferenceContext.limits.maxMessages,
                signal,
              })
              if (snapshot === undefined) throw new Error('Remote reference snapshot was unavailable.')
              const conversation = RemoteReferenceContext.remoteReferenceConversation(snapshot.records)
              if (conversation.length === 0) throw new Error('Remote reference had no readable conversation text.')
              const label = reference.label ?? reference.sessionId
              return createUserMessage({
                source: {
                  kind: 'multi-host-remote-reference',
                  form: 'recall',
                  references: [
                    {
                      sessionId: reference.sessionId,
                      label,
                      capturedThroughSeq: snapshot.cursor,
                    },
                  ],
                },
                content: [{ type: 'text', text: RemoteReferenceContext.remoteReferenceContextText({ sessionId: reference.sessionId, label, conversation }) }],
              })
            }),
          ),
      })
      if (contexts === undefined) return next()

      const rewrittenMessages = messages.map(message => {
        if (message.source.kind !== 'user') return message
        const content = replacements.get(message)
        return content === undefined ? message : createUserMessage({ source: message.source, content })
      })
      messages.splice(0, messages.length, ...rewrittenMessages)
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      return { ...decision, messages: [...decision.messages, ...contexts] }
    },
    { prepend: true },
  )
