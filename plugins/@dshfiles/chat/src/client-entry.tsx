import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import { Browser, defineClient, MenuItem, type BrowserService } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

const BROWSER_KIND = 'browser'
const WEB_PROTOCOLS = new Set(['http:', 'https:'])

export default defineClient({
  name: '@dshfiles/chat',
  inject: [...inject, 'connection'],
  setup(ctx, decorate, metadata) {
    apply(ctx, decorate)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
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
    plugin.add(MenuItem, track =>
      track(browser.available)
        ? {
            id: 'dshfiles-chat.open-web-page',
            menu: 'workbench.new-view',
            title: 'Open web page…',
            keywords: ['browser', 'url', 'web'],
            run: () =>
              void plugin.dialogs.prompt({ title: 'Open web page', placeholder: 'https://example.com' }).then(url => {
                if (url === undefined || browser.open(url.includes('://') ? url : `https://${url}`)) return
                plugin.toast.show({ title: 'Could not open that page', description: 'Enter an http(s) address while a thread is on screen.', tone: 'warning' })
              }),
          }
        : undefined,
    )
  },
})
