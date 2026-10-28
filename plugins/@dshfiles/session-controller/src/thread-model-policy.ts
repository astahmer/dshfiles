import { appendPluginRecord, pluginRecordOf, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { threadModelPolicySchema, type ThreadModelPolicy } from './thread-model-api.ts'

export const THREAD_MODEL_RECORD = 'plugin:dshfiles/session-controller/thread-selection'
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:dshfiles/session-controller/thread-selection': ThreadModelPolicy
  }
}

export const threadModelPolicyProjection = {
  key: 'threadModelPolicy',
  stateSchema: threadModelPolicySchema,
  stateVersion: 1,
  init: (): ThreadModelPolicy => ({ revision: 0, selection: null, preferSelectedProvider: false }),
  apply: (state: ThreadModelPolicy, event: SessionEvent): ThreadModelPolicy => {
    if (event.type === 'model/selection')
      return {
        revision: event.seq + 1,
        selection: event.data,
        preferSelectedProvider: false,
      }
    const record = pluginRecordOf(event)
    if (record?.type !== THREAD_MODEL_RECORD) return state
    const parsed = threadModelPolicySchema.safeParse(record.data)
    // Only a directly adjacent annotation of this exact native selection can grant preference.
    if (
      state.selection === null ||
      state.revision === 0 ||
      !parsed.success ||
      parsed.data.revision !== state.revision ||
      record.seq !== state.revision ||
      parsed.data.selection?.provider !== state.selection?.provider ||
      parsed.data.selection?.model !== state.selection?.model ||
      parsed.data.selection?.reasoningEffort !== state.selection?.reasoningEffort
    )
      return state
    return parsed.data
  },
  wire: { viewSchema: threadModelPolicySchema, view: (state: ThreadModelPolicy) => state },
} satisfies ProjectionDefinition<'threadModelPolicy'>

/** Append immediately after the native selection, without any asynchronous boundary. */
export function annotateThreadModel(session: Session, policy: ThreadModelPolicy): void {
  appendPluginRecord(session, THREAD_MODEL_RECORD, threadModelPolicySchema.parse(policy))
}
