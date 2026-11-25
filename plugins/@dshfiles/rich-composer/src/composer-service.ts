// The fork's own conversation declarations must load before dshx's, which import the upstream package they replace.
import { InputHub } from './native/input/hub.ts'
import type { SessionInputShell } from './native/input/facade.ts'
import { ConversationController } from './native/service.ts'
import { ComposerSnippets } from './composer-snippets.ts'
import type { Context } from '@deepseek-ai/cordis'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { relativizeToCwd, workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ComposerAnnotation, ComposerService, ComposerTarget, Subscribable } from '@dshfiles/dshx/client'
import type { DraftAnnotation } from './native/input/draft-annotations.ts'
import type { SentAnnotation } from './native/input/sent-annotations.ts'

const DRAFT_ID_PREFIX = 'draft:'
const SENT_ID_PREFIX = 'sent:'

/** Split one contract annotation id back into the store that owns it. */
const annotationOwner = (id: string): { readonly kind: 'draft' | 'sent'; readonly id: number } | undefined => {
  const draft = id.startsWith(DRAFT_ID_PREFIX)
  if (!draft && !id.startsWith(SENT_ID_PREFIX)) return undefined
  const local = Number(id.slice(draft ? DRAFT_ID_PREFIX.length : SENT_ID_PREFIX.length))
  return Number.isInteger(local) ? { kind: draft ? 'draft' : 'sent', id: local } : undefined
}

interface ModelDirectories {
  directoryFor(sessionId: SessionId): { select(selection: { provider: string; model: string; reasoningEffort?: string }): Promise<{ readonly ok: boolean }> }
}

const isModelDirectories = (value: unknown): value is ModelDirectories =>
  typeof value === 'object' && value !== null && 'directoryFor' in value && typeof value.directoryFor === 'function'

/** Provides dshx's `Composer` contract over the fork's per-session input shells. */
export const createComposerService = (ctx: Context): ComposerService => {
  const hub = (): InputHub | undefined => {
    const conversation: unknown = ctx.get('conversation')
    return conversation instanceof ConversationController && conversation.input instanceof InputHub ? conversation.input : undefined
  }
  const currentId = (): string | undefined => ctx.uiSession.adapter.current.getSnapshot().key
  const resolve = (sessionId: string | undefined): { readonly id: SessionId; readonly shell: SessionInputShell } | undefined => {
    const id = sessionId ?? currentId()
    const inputHub = hub()
    if (id === undefined || inputHub === undefined || ctx.sessions.binding(SessionId(id)) === undefined) return undefined
    return { id: SessionId(id), shell: inputHub.shell(SessionId(id)) }
  }
  const editable = (shell: SessionInputShell): boolean => shell.snapshot.phase === 'plain' || shell.snapshot.phase === 'claimed'

  const current: Subscribable<string | undefined> = {
    get: currentId,
    subscribe: listener => ctx.uiSession.adapter.current.subscribe(listener),
  }
  const annotations = (target?: ComposerTarget): Subscribable<readonly ComposerAnnotation[]> => {
    const listeners = new Set<() => void>()
    const notify = (): void => { for (const listener of listeners) listener() }
    let boundShell: SessionInputShell | undefined
    let unsubscribeDraft: (() => void) | undefined
    let unsubscribeSent: (() => void) | undefined
    let unsubscribeCurrent: (() => void) | undefined
    let lastDraft: readonly DraftAnnotation[] | undefined
    let lastSent: readonly SentAnnotation[] | undefined
    let lastView: readonly ComposerAnnotation[] = []
    const bind = (): void => {
      const shell = resolve(target?.sessionId)?.shell
      if (shell === boundShell) return
      unsubscribeDraft?.()
      unsubscribeSent?.()
      boundShell = shell
      unsubscribeDraft = shell?.annotations.subscribe(notify)
      unsubscribeSent = shell?.sentAnnotations.subscribe(notify)
    }
    // One stable array per store state: React's external-store read cannot return a fresh array each call.
    const read = (): readonly ComposerAnnotation[] => {
      const shell = resolve(target?.sessionId)?.shell
      const draft = shell?.annotations.snapshot()
      const sent = shell?.sentAnnotations.snapshot()
      if (draft === lastDraft && sent === lastSent) return lastView
      lastDraft = draft
      lastSent = sent
      lastView = [
        ...(sent ?? []).map(annotation => ({
          id: `${SENT_ID_PREFIX}${annotation.id}`, text: annotation.text, comment: annotation.comment,
          source: annotation.source, sent: true,
        })),
        ...(draft ?? []).map(annotation => ({
          id: `${DRAFT_ID_PREFIX}${annotation.id}`, text: annotation.text, comment: annotation.comment,
          source: annotation.source, sent: false,
        })),
      ]
      return lastView
    }
    return {
      get: read,
      subscribe: (listener) => {
        listeners.add(listener)
        if (listeners.size === 1) {
          unsubscribeCurrent = current.subscribe(() => { bind(); notify() })
          bind()
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size > 0) return
          unsubscribeDraft?.()
          unsubscribeSent?.()
          unsubscribeCurrent?.()
          boundShell = undefined
        }
      },
    }
  }
  const focused: Subscribable<boolean> = {
    get: () => {
      const root = resolve(undefined)?.shell.editor.getRootElement()
      return root !== null && root !== undefined && typeof document !== 'undefined' && root.contains(document.activeElement)
    },
    subscribe: listener => {
      if (typeof document === 'undefined') return () => {}
      document.addEventListener('focusin', listener)
      document.addEventListener('focusout', listener)
      const unsubscribeCurrent = current.subscribe(listener)
      return () => {
        document.removeEventListener('focusin', listener)
        document.removeEventListener('focusout', listener)
        unsubscribeCurrent()
      }
    },
  }

  return {
    current,
    focused,
    text: target => resolve(target?.sessionId)?.shell.snapshot.draft,
    setText: input => {
      const target = resolve(input.sessionId)
      if (target === undefined || !editable(target.shell)) return false
      target.shell.setDraft(input.text)
      return true
    },
    insert: input => {
      const target = resolve(input.sessionId)
      if (target === undefined) return false
      return target.shell.actions.insertText(input.text, target.shell.actions.captureInsertion())
    },
    attach: input => {
      const target = resolve(input.sessionId)
      if (target === undefined) return false
      const attachment = input.attachment
      if (attachment.kind === 'annotation') {
        if (!editable(target.shell)) return false
        target.shell.annotations.add({ text: attachment.text, source: attachment.source ?? '', comment: attachment.comment ?? '' })
        return true
      }
      if (attachment.kind !== 'file') return target.shell.addFiles([ComposerSnippets.reference(attachment)], [])
      const cwd = ctx.sessions.list.getSnapshot().byId[target.id]?.cwd
      const mention = formatFileMention({ path: relativizeToCwd(attachment.path, cwd), kind: 'file' }, false)
      if (mention === undefined) return false
      const label = workspaceTitleOf(attachment.path) || attachment.path
      return target.shell.addFiles([{ source: 'reference', ref: mention, label, appearance: 'file', clipboardText: mention }], [])
    },
    annotations,
    setAnnotationComment: input => {
      const shell = resolve(input.sessionId)?.shell
      if (shell === undefined) return false
      const owner = annotationOwner(input.id)
      if (owner === undefined) return false
      if (owner.kind === 'sent') shell.sentAnnotations.setComment({ id: owner.id, comment: input.comment })
      else shell.annotations.setComment({ id: owner.id, comment: input.comment })
      return true
    },
    removeAnnotation: input => {
      const shell = resolve(input.sessionId)?.shell
      if (shell === undefined) return false
      const owner = annotationOwner(input.id)
      if (owner === undefined) return false
      if (owner.kind === 'sent') shell.sentAnnotations.remove(owner.id)
      else shell.annotations.remove(owner.id)
      return true
    },
    setModel: async input => {
      const target = resolve(input.sessionId)
      const directories: unknown = ctx.get('modelDirectories')
      if (target === undefined || !isModelDirectories(directories)) return false
      try {
        const result = await directories.directoryFor(target.id).select({
          provider: input.selection.provider,
          model: input.selection.model,
          ...(input.selection.variant !== undefined && { reasoningEffort: input.selection.variant }),
        })
        return result.ok
      } catch {
        return false
      }
    },
    focus: target => {
      const resolved = resolve(target?.sessionId)
      if (resolved === undefined) return false
      resolved.shell.focus()
      return true
    },
  }
}
