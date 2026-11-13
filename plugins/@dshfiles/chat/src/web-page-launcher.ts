import { Command, MenuItem, type BrowserService, type PluginContext } from '@dshfiles/dshx/client'

export const registerWebPageLauncher = ({ plugin, browser }: { plugin: PluginContext; browser: BrowserService }): void => {
  const run = () =>
    void plugin.dialogs.prompt({ title: 'Open web page', placeholder: 'https://example.com' }).then(url => {
      if (url === undefined || browser.open(url.includes('://') ? url : `https://${url}`)) return
      plugin.toast.show({ title: 'Could not open that page', description: 'Enter an http(s) address while a thread is on screen.', tone: 'warning' })
    })
  const item = { id: '@dshfiles/chat.open-web-page', title: 'Open web page…', keywords: ['browser', 'url', 'web'], run }
  plugin.add(MenuItem, track => (track(browser.available) ? { ...item, menu: 'workbench.new-view' } : undefined))
  plugin.add(Command, track => (track(browser.available) ? item : undefined))
}
