import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { Command, defineClientPlugin, type ComposerActionProps } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { createDraftAttachmentKeeper } from './draft-attachment-retention.js'
import { PromptHistoryTargets } from './prompt-history-targets.js'
import PromptLibraryAction from './prompt-stash-action.js'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A composer that holds draft attachments keeps its thread's session scope, which owns them. */
    composerDraftAttachments: unknown
  }
}

export default defineClientPlugin({
  id: 'prompt-stash',
  uses: ['composer'],
  inject: ['sessions'],
  setup(api) {
    const sessions = api.raw.ctx.sessions
    const attachmentKeeper = createDraftAttachmentKeeper<ComposerActionProps['sessionId']>({
      retain: sessionId => {
        try {
          const reference = sessions.retain(sessionId, { source: 'composerDraftAttachments' })
          return () => reference.release()
        } catch {
          return () => undefined
        }
      },
    })
    api.lifecycle.onDispose(attachmentKeeper.dispose)
    const active = (): Element | null => (typeof document === 'undefined' ? null : document.activeElement)
    api.add(Command, {
      id: PromptHistoryTargets.paletteCommandId,
      title: 'Search prompt history',
      keywords: ['prompts', 'history', 'sent', 'recall', 'library'],
      run: () => (PromptHistoryTargets.open({ focusedOnly: false, active: active() }) ? undefined : false),
    })
    api.composer.registerAction({
      id: 'prompt-stash-action',
      placement: 'right',
      order: 60,
      component: props => (
        <PluginQueryProvider>
          <PromptLibraryAction {...props} attachmentKeeper={attachmentKeeper} />
        </PluginQueryProvider>
      ),
    })
  },
})
