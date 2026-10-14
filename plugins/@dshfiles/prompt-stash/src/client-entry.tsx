import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { defineClientPlugin, type ComposerActionProps } from '@dshfiles/dshx/client'
import { createDraftAttachmentKeeper } from './draft-attachment-retention.js'
import PromptLibraryAction from './prompt-stash-action.js'
import { PromptStashAction as PromptDraftsAction } from './prompt-stash.js'
import './client.css'

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
    api.composer.registerAction({
      id: 'prompt-stash-drafts',
      placement: 'left',
      component: props => <PromptDraftsAction {...props} attachmentKeeper={attachmentKeeper} />,
    })
    api.composer.registerAction({
      id: 'prompt-stash-action',
      placement: 'right',
      order: 60,
      component: PromptLibraryAction,
    })
  },
})
