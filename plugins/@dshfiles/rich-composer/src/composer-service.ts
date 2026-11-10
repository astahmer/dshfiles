// The fork's own conversation declarations must load before dshx's, which import the upstream package they replace.
import { InputHub } from './native/input/hub.ts'
import type { SessionInputShell } from './native/input/facade.ts'
import { ConversationController } from './native/service.ts'
import { ComposerSnippets } from './composer-snippets.ts'
import type { Context } from '@deepseek-ai/cordis'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { relativizeToCwd, workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ComposerService, Subscribable } from '@dshfiles/dshx/client'

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
      if (attachment.kind !== 'file') return target.shell.addFiles([ComposerSnippets.reference(attachment)], [])
      const cwd = ctx.sessions.list.getSnapshot().byId[target.id]?.cwd
      const mention = formatFileMention({ path: relativizeToCwd(attachment.path, cwd), kind: 'file' }, false)
      if (mention === undefined) return false
      const label = workspaceTitleOf(attachment.path) || attachment.path
      return target.shell.addFiles([{ source: 'reference', ref: mention, label, appearance: 'file', clipboardText: mention }], [])
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
