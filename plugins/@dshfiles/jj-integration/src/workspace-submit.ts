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

/**
 * Deliver a New thread's first send into the thread workspace it isolates to, whatever the main view shows by then:
 * the draft moves into that workspace's Session through its own input, is sent there, and the source is cleared. The
 * view follows only while it still shows the source, so opening another New thread meanwhile keeps both threads.
 */
export const deliverFirstSend = async <Composer extends WorkspaceComposer>(input: {
  readonly source: WorkspaceComposer
  readonly submitSource: 'click' | 'enter'
  /** Where this thread moves; null keeps it where it is. */
  readonly destination: (signal: AbortSignal) => Promise<{ readonly isolate: boolean } | null>
  readonly isolate: (signal: AbortSignal) => Promise<{ readonly workspaceId: string }>
  readonly composerIn: (workspaceId: string, signal: AbortSignal) => Promise<Composer>
  /** Copies the source draft, attachments and references into the target; false when the target refused them. */
  readonly copyDraft: (target: Composer, signal: AbortSignal) => Promise<boolean>
  readonly clearSource: () => void
  readonly showsSource: () => boolean
  readonly show: (sessionId: SessionId) => void
  readonly blocks: Pick<ComposerBlocks, 'set'>
  readonly reason: string
  readonly failureMessage: string
  readonly changedMessage: string
  readonly signal: AbortSignal
}): Promise<'sent' | 'kept' | 'failed' | 'changed' | 'cancelled' | 'not-ready'> => {
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
    const move = await input.destination(input.signal)
    if (move === null || !move.isolate) {
      release()
      input.source.input.submit('queue', input.submitSource)
      return 'kept'
    }
    const landed = await input.isolate(input.signal)
    const target = await input.composerIn(landed.workspaceId, input.signal)
    if (input.signal.aborted) return 'cancelled'

    const sourceState = input.source.input.state.getSnapshot()
    const targetState = target.input.state.getSnapshot()
    if (!sameDraft(requested, sourceState) || targetState.phase !== 'plain' || targetState.draft !== '' || targetState.attachmentIds.length > 0) {
      input.source.input.notify('error', input.changedMessage)
      return 'changed'
    }
    const copied = await input.copyDraft(target, input.signal)
    const targetDraft = target.input.state.getSnapshot()
    // Carried attachments get new ids in the target Session, so the copy is checked by text and count.
    if (!copied || targetDraft.draft !== requested.draft || targetDraft.attachmentIds.length !== requested.attachmentIds.length) {
      input.source.input.notify('error', input.failureMessage)
      return 'failed'
    }
    target.input.submit('queue', input.submitSource)
    release()
    input.clearSource()
    if (input.showsSource()) input.show(target.sessionId)
    return 'sent'
  } catch {
    if (input.signal.aborted) return 'cancelled'
    input.source.input.notify('error', input.failureMessage)
    return 'failed'
  } finally {
    release()
  }
}
