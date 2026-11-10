import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { Browser, Command, defineClient, type BrowserService } from '@dshfiles/dshx/client'
import { registerWebPageLauncher } from './web-page-launcher.ts'
import { apply, inject } from './native/index.ts'
import { PinnedToolCalls } from './pinned-tool-calls.ts'
import { PinnedToolNames } from './pinned-tool-names.ts'
import { TranscriptFind } from './transcript-find.ts'

const BROWSER_KIND = 'browser'
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

export default defineClient({
  name: '@dshfiles/chat',
  inject: [...inject, 'connection'],
  setup(ctx, decorate, metadata) {
    apply(ctx, decorate)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    plugin.add(Command, {
      id: TranscriptFind.commandId,
      title: 'Find in thread',
      keywords: ['search', 'find', 'transcript', 'messages'],
      keys: TranscriptFind.keys,
      run: () => (TranscriptFind.open() ? undefined : false),
    })
    ctx.effect(() => PinnedToolNames.follow({ providers: plugin.list(PinnedToolCalls), events: ctx.uiConversation.events }))
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
    registerWebPageLauncher({ plugin, browser })
  },
})
