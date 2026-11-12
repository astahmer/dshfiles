import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useId } from 'react'
import type { InboxTranslate } from './inbox-locales.js'
import { webPushApi, WEB_PUSH_WORKER_PATH, WEB_PUSH_WORKER_SCOPE } from './web-push-api.js'

const keys = { subscription: ['activity-timeline', 'web-push', 'subscription'] as const, status: ['activity-timeline', 'web-push', 'status'] as const }

type Support = 'supported' | 'ios-home-screen' | 'unsupported'

/** Push needs a service worker and the Push API; on iOS both exist only in a Home Screen app (iOS 16.4+). */
const support = (): Support => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext) return 'supported'
  const ios = /iPhone|iPad|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios ? 'ios-home-screen' : 'unsupported'
}

/** A name the device list can show, from the browser's own description; no identifier leaves the device. */
const deviceLabel = (): string => {
  const agent = navigator.userAgent
  const device = /iPhone/u.test(agent)
    ? 'iPhone'
    : /iPad/u.test(agent)
      ? 'iPad'
      : /Android/u.test(agent)
        ? 'Android'
        : /Mac OS X/u.test(agent)
          ? 'Mac'
          : /Windows/u.test(agent)
            ? 'Windows'
            : 'Device'
  const browser = /CriOS|Chrome/u.test(agent) ? 'Chrome' : /Firefox|FxiOS/u.test(agent) ? 'Firefox' : /Safari/u.test(agent) ? 'Safari' : 'browser'
  return `${device} · ${browser}`
}

const keyBytes = (base64url: string): Uint8Array<ArrayBuffer> => {
  const text = atob(base64url.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(new ArrayBuffer(text.length))
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return bytes
}

const registration = (): Promise<ServiceWorkerRegistration | undefined> => navigator.serviceWorker.getRegistration(WEB_PUSH_WORKER_SCOPE)

/**
 * Push to this device (productivity pass T6.5): one switch per device under the in-tab alerts. On subscribes this
 * browser with the Host's key, Off unsubscribes it; Send test proves the path end to end. A notification click opens
 * the item's thread in this window (the worker cannot navigate a page it does not control, so it tells the page).
 */
const Control = (props: { readonly t: InboxTranslate }): JSX.Element | null => {
  const api = useApi(webPushApi)
  const id = useId()
  const queryClient = useQueryClient()
  const mode = support()
  useEffect(() => {
    if (mode !== 'supported') return
    const open = (event: MessageEvent): void => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null || (data as { type?: unknown }).type !== 'dshfiles-web-push-open') return
      const url = (data as { url?: unknown }).url
      if (typeof url === 'string' && new URL(url).origin === window.location.origin) window.location.assign(url)
    }
    navigator.serviceWorker.addEventListener('message', open)
    return () => navigator.serviceWorker.removeEventListener('message', open)
  }, [mode])
  const subscription = useQuery({
    queryKey: keys.subscription,
    enabled: mode === 'supported',
    queryFn: async () => (await (await registration())?.pushManager.getSubscription()) ?? null,
  })
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (!on) {
        const current = await (await registration())?.pushManager.getSubscription()
        if (current !== null && current !== undefined) {
          await api.unsubscribe({ endpoint: current.endpoint })
          await current.unsubscribe()
        }
        return
      }
      if ((await Notification.requestPermission()) !== 'granted') throw new Error(props.t('pushDenied'))
      const status = await api.status({})
      const worker = await navigator.serviceWorker.register(new URL(WEB_PUSH_WORKER_PATH, window.location.origin), { scope: WEB_PUSH_WORKER_SCOPE })
      const created = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.publicKey) })
      const json = created.toJSON()
      const p256dh = json.keys?.['p256dh']
      const auth = json.keys?.['auth']
      if (p256dh === undefined || auth === undefined) throw new Error(props.t('pushNoKeys'))
      await api.subscribe({ subscription: { endpoint: created.endpoint, p256dh, auth }, label: deviceLabel() })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.subscription }),
  })
  const test = useMutation({ mutationFn: () => api.test({}) })
  if (mode === 'unsupported') return null
  if (mode === 'ios-home-screen') return <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('pushHomeScreen')}</p>
  const on = subscription.data !== null && subscription.data !== undefined
  return (
    <div className="dshx:flex dshx:max-w-full dshx:flex-col dshx:gap-1" data-inbox-push="">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Switch id={id} checked={on} disabled={toggle.isPending || subscription.isPending} onCheckedChange={next => toggle.mutate(next)} />
        <Label htmlFor={id} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
          {props.t('pushToDevice')}
        </Label>
        {on ? (
          <Button size="xs" variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>
            {props.t('pushTest')}
          </Button>
        ) : null}
      </div>
      {toggle.error === null ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {errorMessage(toggle.error, props.t('pushFailed'))}
        </p>
      )}
      {test.data === undefined ? null : (
        <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
          {test.data.failed === 0 ? props.t('pushTestSent', { count: test.data.sent }) : test.data.errors.join(' ')}
        </p>
      )}
    </div>
  )
}

export class InboxPush {
  static readonly Control = Control
  static readonly support = support
}
