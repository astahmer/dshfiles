import { Command, MenuItem, type BrowserService, type PluginContext } from '@dshfiles/dshx/client'
import { LinkEmbedPort } from './link-embed-port.ts'

export const registerWebPageLauncher = ({ plugin, browser }: { plugin: PluginContext; browser: BrowserService }): void => {
  const run = () =>
    void plugin.dialogs.prompt({ title: 'Open web page', placeholder: 'https://example.com' }).then(url => {
      if (url === undefined) return
      const href = url.includes('://') ? url : `https://${url}`
      if (!browser.open(href)) {
        plugin.toast.show({ title: 'Could not open that page', description: 'Enter an http(s) address while a thread is on screen.', tone: 'warning' })
        return
      }
      // A site that forbids framing leaves the pane blank, which the pane cannot report: ask the Host and say it.
      LinkEmbedPort.sayIfRefused(href)
    })
  const item = { id: '@dshfiles/chat.open-web-page', title: 'Open web page…', keywords: ['browser', 'url', 'web'], run }
  plugin.add(MenuItem, track => (track(browser.available) ? { ...item, menu: 'workbench.new-view' } : undefined))
  plugin.add(Command, track => (track(browser.available) ? item : undefined))
}
