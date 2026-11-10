import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { Browser, defineClient, type BrowserService } from '@dshfiles/dshx/client'
import { registerWebPageLauncher } from './web-page-launcher.ts'
import { apply, inject } from './native/index.ts'
import { PinnedToolCalls } from './pinned-tool-calls.ts'
import { PinnedToolNames } from './pinned-tool-names.ts'

const BROWSER_KIND = 'browser'
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

export default defineClient({
  name: '@dshfiles/chat',
  inject: [...inject, 'connection'],
  setup(ctx, decorate, metadata) {
    apply(ctx, decorate)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
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
