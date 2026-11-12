/**
 * The push service worker the Host serves at `WEB_PUSH_WORKER_PATH` (productivity pass T6.5). It shows each push as a
 * notification and, on a click, focuses a DSH window on the item's thread (or opens one). Its scope is its own folder,
 * so it never controls or caches a DSH page. Plain script text: the browser loads it from the Host origin.
 */
export const WEB_PUSH_WORKER_SOURCE = `'use strict'
// dshfiles activity-timeline: Inbox push for blocking items. Holds no data and caches nothing.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'DSH', body: event.data ? event.data.text() : '' } }
  const root = new URL('../', self.registration.scope)
  event.waitUntil(self.registration.showNotification(data.title || 'DSH', {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: new URL(data.path || '', root).href },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || new URL('../', self.registration.scope).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find(client => client.url.startsWith(new URL('../', self.registration.scope).href))
    if (open) {
      // This worker controls no DSH page, so it cannot navigate one: the page goes to the item when told (web-push-client).
      open.postMessage({ type: 'dshfiles-web-push-open', url })
      await open.focus()
      return
    }
    await self.clients.openWindow(url)
  })())
})
`
