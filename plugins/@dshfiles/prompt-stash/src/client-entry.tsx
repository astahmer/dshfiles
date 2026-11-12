import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { InboxQuickReplies, type InboxQuickReply } from '@dshfiles/activity-timeline/quick-replies'
import { Command, Composer, createApiClient, defineClientPlugin, useContract, type ComposerActionProps } from '@dshfiles/dshx/client'
import { promptStashApi } from './library-api.js'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ComposerBar, ComposerMoreItems, type ComposerBarPlacement } from '@dshfiles/rich-composer/composer-more'
import { useSyncExternalStore } from 'react'
import { promptLibraryRequests } from './composer-rows.js'
import { createDraftAttachmentKeeper } from './draft-attachment-retention.js'
import { PromptHistoryTargets } from './prompt-history-targets.js'
import PromptLibraryAction from './prompt-stash-action.js'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A composer that holds draft attachments keeps its thread's session scope, which owns them. */
    composerDraftAttachments: unknown
  }
}

/**
 * The Inbox's quick replies: the first saved prompts, or three starters while the library is empty. A prompt's title is
 * the chip, its text the message (plan Q2 T2.5).
 */
const STARTER_REPLIES: readonly InboxQuickReply[] = [
  { id: 'starter-continue', label: 'Continue', text: 'Continue.' },
  { id: 'starter-checks-then-land', label: 'Run checks, then land', text: 'Run the checks, fix what fails, then land the work.' },
  { id: 'starter-explain-blocker', label: 'Explain the blocker', text: 'Explain what is blocking you and what you need from me.' },
]
const QUICK_REPLY_COUNT = 3

const noSubscription = (): (() => void) => () => undefined
const alwaysPinned = (): boolean => true

/** Pinned (the button in the bar) unless the composer owner says the user moved it into its More menu. */
const usePinned = (): boolean => {
  const bar = useContract(ComposerBar)
  const placement: ComposerBarPlacement | undefined = bar.status === 'active' ? bar.value : undefined
  return useSyncExternalStore(placement?.subscribe ?? noSubscription, placement?.pinned ?? alwaysPinned, placement?.pinned ?? alwaysPinned)
}

const PromptLibrarySeat = (props: ComposerActionProps & { readonly attachmentKeeper: Parameters<typeof PromptLibraryAction>[0]['attachmentKeeper'] }) => (
  <PluginQueryProvider>
    <PromptLibraryAction {...props} pinned={usePinned()} />
  </PluginQueryProvider>
)

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
    const library = createApiClient(api.raw.ctx, promptStashApi)
    api.add(InboxQuickReplies, {
      id: 'prompt-stash',
      list: async signal => {
        const state = await library.state(undefined, signal === undefined ? {} : { signal })
        const saved = state.prompts.slice(0, QUICK_REPLY_COUNT).map(prompt => ({ id: prompt.id, label: prompt.title, text: prompt.text }))
        return saved.length === 0 ? STARTER_REPLIES : saved
      },
    })
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
      component: props => <PromptLibrarySeat {...props} attachmentKeeper={attachmentKeeper} />,
    })
    // Rows of the composer's More menu (polish pass b:r4et); `/prompts` opens the library from the keyboard.
    api.add(ComposerMoreItems, {
      id: '@dshfiles/prompt-stash.saved',
      group: 'prompts',
      order: 20,
      label: 'Saved prompts…',
      keys: ['/prompts'],
      select: sessionId => promptLibraryRequests.send(sessionId, 'saved'),
    })
    api.add(ComposerMoreItems, {
      id: '@dshfiles/prompt-stash.recent',
      group: 'prompts',
      order: 21,
      label: 'Recent messages here…',
      // The editor's own recall: ↑ in an empty composer brings back the previous message.
      keys: ['↑'],
      select: sessionId => promptLibraryRequests.send(sessionId, 'recent'),
    })
    // Upstream's prompt history (zumlvwvq) is the library's third tab; the menu reaches it beside the other two.
    api.add(ComposerMoreItems, {
      id: '@dshfiles/prompt-stash.history',
      group: 'prompts',
      order: 22,
      label: 'Prompt history…',
      keys: ['⌃R'],
      select: sessionId => promptLibraryRequests.send(sessionId, 'history'),
    })
    const composer = api.use(Composer)
    api.add(Command, {
      id: '@dshfiles/prompt-stash.open',
      title: 'Saved prompts',
      description: 'Insert, save or edit a saved prompt in the composer on screen.',
      keywords: ['prompt', 'library', 'snippet'],
      group: 'Composer',
      slash: 'prompts',
      run: () => {
        const live = composer.get()
        const sessionId = live.status === 'active' ? live.value.current.get() : undefined
        if (sessionId !== undefined) promptLibraryRequests.send(sessionId, 'saved')
      },
    })
  },
})
