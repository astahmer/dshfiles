import { ClientTools, defineClientPlugin, SessionScreen, subscribeApiEvent } from '@dshfiles/dshx/client'
import { BridgeLimits, clientBridgeApi, type WindowState } from './api.js'
import { InvokeRunner } from './invoke-runner.js'
import { WindowStateModel } from './window-state.js'

const NARROW = '(max-width: 640px)'
const SETTLE_MS = 150

/**
 * The browser half: announce this window (focus, the thread on screen, the client tools other plugins added) to the
 * Host, and run the client tool calls the Host addresses to it.
 */
export default defineClientPlugin({
  id: 'dshfiles-client-bridge',
  name: '@dshfiles/client-bridge',
  uses: ['rpc'],
  setup(api) {
    const rpc = api.rpc.use(clientBridgeApi)
    const clientId = WindowStateModel.newClientId()
    const tools = api.list(ClientTools)
    const screen = api.use(SessionScreen)
    const label = WindowStateModel.label(navigator.userAgent, window.matchMedia(NARROW).matches)

    const currentSession = (): string | undefined => {
      const live = screen.get()
      return live.status === 'active' ? live.value.current.get() : undefined
    }
    const state = (): WindowState =>
      WindowStateModel.build({
        clientId,
        label,
        focused: document.hasFocus(),
        visible: document.visibilityState === 'visible',
        sessionId: currentSession(),
        tools: WindowStateModel.descriptors(tools.get(), message => console.warn(message)),
      })

    let sent = ''
    let pending: ReturnType<typeof setTimeout> | undefined
    const send = (force: boolean): void => {
      const next = state()
      const serialized = JSON.stringify(next)
      if (!force && serialized === sent) return
      sent = serialized
      void rpc.safe.announce(next).then(result => {
        // A Host without this plugin, or a refused call, is announced again on the next change or heartbeat.
        if (!result.ok) sent = ''
      })
    }
    const announce = (): void => {
      if (pending !== undefined) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = undefined
        send(false)
      }, SETTLE_MS)
    }

    // The thread on screen comes from whichever plugin provides SessionScreen; follow it while one does.
    let offCurrent: (() => void) | undefined
    const followScreen = (): void => {
      offCurrent?.()
      offCurrent = undefined
      const live = screen.get()
      if (live.status === 'active') offCurrent = live.value.current.subscribe(announce)
      announce()
    }
    const offScreen = screen.subscribe(followScreen)
    followScreen()
    const offTools = tools.subscribe(announce)

    window.addEventListener('focus', announce)
    window.addEventListener('blur', announce)
    document.addEventListener('visibilitychange', announce)
    const heartbeat = setInterval(() => send(true), BridgeLimits.heartbeatMs)
    const leave = (): void => {
      void rpc.safe.leave({ clientId })
    }
    window.addEventListener('pagehide', leave)

    const offInvoke = subscribeApiEvent(rpc, 'invoke', {
      onEvent: request => {
        void InvokeRunner.run({
          request,
          clientId,
          tools: tools.get(),
          notice: tool => {
            api.toast.show({
              title: `Agent: ${tool.title}`,
              description: 'An agent did this in your window. Settings › Client Bridge turns agent control or these notices off.',
              duration: 5_000,
            })
          },
          reply: completion => rpc.safe.complete(completion),
        })
      },
      // A restarted Host forgot every window: announce again once its event stream is back.
      onStatus: status => {
        if (status === 'live') send(true)
      },
    })

    api.onDispose(() => {
      if (pending !== undefined) clearTimeout(pending)
      clearInterval(heartbeat)
      offInvoke()
      offTools()
      offScreen()
      offCurrent?.()
      window.removeEventListener('focus', announce)
      window.removeEventListener('blur', announce)
      document.removeEventListener('visibilitychange', announce)
      window.removeEventListener('pagehide', leave)
      leave()
    })
  },
})
