import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { Browser, Command, createRegisteredApiClient, defineClient, type BrowserService } from '@dshfiles/dshx/client'
import { ChatViewRegistry } from './native/chat/chat-view-registry.ts'
import { registerWebPageLauncher } from './web-page-launcher.ts'
import { apply, inject } from './native/index.ts'
import { SESSION_SEARCH_FIND_API, ThreadFindPort } from './thread-find-port.ts'
import { PinnedToolCalls } from './pinned-tool-calls.ts'
import { PinnedToolNames } from './pinned-tool-names.ts'
import { TranscriptRunFolds } from './run-folds.ts'
import { RunFoldKinds } from './run-fold-kinds.ts'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { TurnAdmissionDock, TurnAdmissionSettingsRow } from './turn-admission-panel.tsx'

const BROWSER_KIND = 'browser'
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

export default defineClient({
  name: '@dshfiles/chat',
  inject: [...inject, 'connection'],
  setup(ctx, decorate, metadata) {
    apply(ctx, decorate)
    // The running-thread limit belongs to @dshfiles/session-controller; its Settings row and waiting notice live here,
    // beside the composer, and hide themselves while that Host API is absent.
    ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register(
        { name: 'settings.general.item', id: 'dshfiles-running-threads-limit', order: 40 },
        decorate(() => (
          <PluginQueryProvider>
            <TurnAdmissionSettingsRow />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register(
        { name: 'conversation.input.dock', id: 'dshfiles-turn-admission-waiting', order: 1, inject: (sessionId: string) => ({ sessionId }) },
        decorate((props: { readonly sessionId: string }) => (
          <PluginQueryProvider>
            <TurnAdmissionDock sessionId={props.sessionId} />
          </PluginQueryProvider>
        )),
      ),
    )
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    ctx.effect(() => PinnedToolNames.follow({ providers: plugin.list(PinnedToolCalls), events: ctx.uiConversation.events }))
    // dshfiles (b:7rv2): providers name the rows (background jobs, subagents) whose consecutive runs fold.
    ctx.effect(() => RunFoldKinds.follow(plugin.list(TranscriptRunFolds)))
    // The browser page type comes from another Host package, so it can appear or vanish after this plugin starts.
    const browser: BrowserService = {
      available: {
        get: () => ctx.get('sidebarRightTabs')?.get(BROWSER_KIND) !== undefined,
        subscribe: listener => ctx.get('sidebarRightTabs')?.subscribe(listener) ?? (() => {}),
      },
      open: url => {
        if (!URL.canParse(url) || !WEB_PROTOCOLS.has(new URL(url).protocol) || !browser.available.get()) return false
        try {
          ctx.sidebarRight.openTab(BROWSER_KIND, { params: { url } })
          return true
        } catch {
          return false
        }
      },
    }
    plugin.provide(Browser, browser)
    // dshfiles (productivity pass Q4): find in thread asks session-search by registered identity (see thread-find-port).
    const finder = createRegisteredApiClient(ctx, SESSION_SEARCH_FIND_API)
    ThreadFindPort.set((input, signal) => {
      const findInThread = finder.findInThread
      if (findInThread === undefined) return Promise.reject(new Error('Thread search is not installed.'))
      return findInThread(input, { signal }).then(ThreadFindPort.decodeReply)
    })
    // One registry serves these keys, the palette and the `?` sheet; each acts on the Chat view the user is in.
    plugin.add(Command, {
      id: '@dshfiles/chat.find',
      title: 'Find in thread',
      keywords: ['search', 'find', 'text', 'thread'],
      keys: ['Mod+F'],
      scope: 'global',
      section: 'Thread',
      run: () => {
        const view = ChatViewRegistry.active()
        // No thread on screen, or the find field already has focus: the second ⌘F is the browser's find.
        if (view === null || view.findFocused()) return false
        view.openFind()
      },
    })
    plugin.add(Command, {
      id: '@dshfiles/chat.previous-turn',
      title: 'Previous turn',
      keywords: ['turn', 'jump', 'up'],
      keys: ['[', 'Alt+ArrowUp'],
      scope: 'not-typing',
      section: 'Thread',
      run: () => {
        const view = ChatViewRegistry.active()
        if (view === null || !view.stepTurn('previous')) return false
      },
    })
    plugin.add(Command, {
      id: '@dshfiles/chat.next-turn',
      title: 'Next turn',
      keywords: ['turn', 'jump', 'down'],
      keys: [']', 'Alt+ArrowDown'],
      scope: 'not-typing',
      section: 'Thread',
      run: () => {
        const view = ChatViewRegistry.active()
        if (view === null || !view.stepTurn('next')) return false
      },
    })
    plugin.add(Command, {
      id: '@dshfiles/chat.turns',
      title: 'Turns of this thread',
      keywords: ['turns', 'outline', 'questions', 'errors', 'edits'],
      section: 'Thread',
      run: () => {
        const view = ChatViewRegistry.active()
        if (view === null) return false
        view.openTurns()
      },
    })
    registerWebPageLauncher({ plugin, browser })
  },
})
