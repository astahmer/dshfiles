import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { Effect, Layer } from 'effect'

import { MemoryGuidance } from './guidance.ts'
import { Recall, type Caller } from './recall.ts'
import { SessionReads } from './session-reads-promise.ts'
import { WorkspaceScripts } from './workspace-scripts.ts'

type PromptSection = { readonly name: string; readonly text: string; readonly interpolate: boolean }

const blocksText = (blocks: readonly { readonly type: string; readonly text?: string }[]): string =>
  blocks.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n')

/**
 * The block is appended to the system prompt at the first assembly of each agent (subagents included) and frozen
 * there, so it sits in the stable prefix and is never re-emitted mid-thread. `system-prompt/assemble` is a Cordis
 * waterfall hook (`next()` first), which `HostEvents` cannot express yet, so this edge registers it directly.
 */
export const PromptHook = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const recall = yield* Recall
    const sessions = yield* SessionReads
    const scripts = yield* WorkspaceScripts

    const sectionsFor = yield* DshxPlugin.callback((caller: Caller, sessionId: string, cwd: string | undefined) =>
      Effect.gen(function* () {
        const firstUserText = Effect.map(sessions.read(sessionId), log => {
          const first = log.events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
          return first?.type === 'user/message' ? blocksText(first.data.content) : undefined
        }).pipe(Effect.orElseSucceed(() => undefined))
        const text = yield* recall.startBlock(caller, firstUserText)
        const workspace = yield* scripts.forCwd(cwd)
        const sections: PromptSection[] = [
          ...(text.length === 0 ? [] : [{ name: 'dshfiles-memory:start-block', text, interpolate: false }]),
          ...(workspace === null ? [] : [{ name: 'dshfiles-memory:workspace-scripts', text: MemoryGuidance.workspaceScripts(workspace), interpolate: false }]),
        ]
        if (sections.length > 0) yield* recall.countBlockRequest(Buffer.byteLength(text))
        return sections
      }).pipe(
        Effect.catchCause(cause => Effect.logWarning(`memory: no start block for ${caller.id}`, cause).pipe(Effect.as<readonly PromptSection[]>([]))),
        Effect.withSpan('memory system prompt sections'),
      ),
    )

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
          const assembled = await next()
          const agent = context.agent
          if (!agent) return assembled
          const sections = await sectionsFor({ id: agent.id, session: { header: agent.session.header } }, agent.session.id, agent.session.header.cwd)
          if (sections.length === 0) return assembled
          return { ...assembled, sections: [...assembled.sections, ...sections] }
        }),
      ),
      dispose => Effect.sync(dispose),
    )
  }),
)
