import type { ComposerBlocks } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceToggle, type WorkspaceToggleActor } from './workspace-toggle-machine.js'

type ComposerState = {
  readonly draft: string
  readonly attachmentIds: readonly string[]
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

type ComposerInput = {
  readonly state: { getSnapshot(): ComposerState }
  submit(mode: 'queue', source: 'click' | 'enter'): void
  notify(level: 'info' | 'error', text: string): void
}

export interface WorkspaceComposer {
  readonly sessionId: SessionId
  readonly workspaceId: string
  readonly blank: boolean
  readonly input: ComposerInput
}

const sameDraft = (left: ComposerState, right: ComposerState): boolean =>
  left.draft === right.draft &&
  left.attachmentIds.length === right.attachmentIds.length &&
  left.attachmentIds.every((id, index) => right.attachmentIds[index] === id)

export const deferWorkspaceSubmit = async (input: {
  readonly actor: WorkspaceToggleActor
  readonly source: WorkspaceComposer
  readonly submitSource: 'click' | 'enter'
  readonly current: () => WorkspaceComposer | undefined
  readonly blocks: Pick<ComposerBlocks, 'set'>
  readonly reason: string
  readonly failureMessage: string
  readonly changedMessage: string
  readonly signal: AbortSignal
}): Promise<'sent' | 'failed' | 'changed' | 'cancelled' | 'not-ready'> => {
  const requested = input.source.input.state.getSnapshot()
  if (requested.phase !== 'plain' || (requested.draft.trim() === '' && requested.attachmentIds.length === 0)) return 'not-ready'

  input.blocks.set(input.source.sessionId, { reason: input.reason })
  let blocked = true
  const release = (): void => {
    if (!blocked) return
    blocked = false
    input.blocks.set(input.source.sessionId, undefined)
  }
  try {
    const outcome = await WorkspaceToggle.waitForWorkspaceToggle({ actor: input.actor, signal: input.signal })
    if (input.signal.aborted) return 'cancelled'
    if (outcome.error !== null) {
      const current = input.current()
      const notificationTarget = current?.input ?? input.source.input
      notificationTarget.notify('error', input.failureMessage)
      return 'failed'
    }

    const current = input.current()
    if (current === undefined || !current.blank || current.workspaceId !== (outcome.workspaceId ?? input.source.workspaceId)) {
      input.source.input.notify('error', input.failureMessage)
      return 'failed'
    }

    const currentState = current.input.state.getSnapshot()
    if (currentState.phase !== 'plain' || !sameDraft(requested, currentState)) {
      current.input.notify('error', input.changedMessage)
      return 'changed'
    }

    release()
    current.input.submit('queue', input.submitSource)
    return 'sent'
  } catch {
    if (input.signal.aborted) return 'cancelled'
    input.source.input.notify('error', input.failureMessage)
    return 'failed'
  } finally {
    release()
  }
}
