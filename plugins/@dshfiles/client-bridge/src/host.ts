import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer } from 'effect'
import { clientBridgeApi } from './api.js'
import { ClientBridge } from './bridge.js'
import { callerSession, runClientToolCall, type InvokePayload } from './client-tool-call.js'
import { ClientToolRefused } from './errors.js'
import { clientBridgeSettings, type ClientBridgeSettings } from './settings.js'
import { BridgeWindows } from './windows.js'

const settingsTag = Settings.Tag<ClientBridgeSettings>(clientBridgeSettings.namespace)
const currentSettings = Effect.flatMap(settingsTag, service => service.get)

const fromWindowOnly = (caller: ApiCaller) =>
  caller.kind === 'client'
    ? Effect.void
    : Effect.fail(new ClientToolRefused({ reason: 'not-agent', recovery: 'Only a DSH browser window announces itself or reports a result.' }))

export const clientBridgeHandlers = Api.handlers(clientBridgeApi, {
  announce: (input, { caller }) =>
    Effect.gen(function* () {
      yield* fromWindowOnly(caller)
      yield* ClientBridge.use(bridge => bridge.announce(input))
      return { accepted: true }
    }),
  leave: (input, { caller }) =>
    Effect.gen(function* () {
      yield* fromWindowOnly(caller)
      return { removed: yield* ClientBridge.use(bridge => bridge.leave(input.clientId)) }
    }),
  complete: (input, { caller }) =>
    Effect.gen(function* () {
      yield* fromWindowOnly(caller)
      return { accepted: yield* ClientBridge.use(bridge => bridge.complete(input)) }
    }),
  list: (_input, { caller }) =>
    Effect.gen(function* () {
      const settings = yield* currentSettings
      const windows = yield* ClientBridge.use(bridge => bridge.windows)
      return { enabled: settings.enabled, windows: [...BridgeWindows.view(windows, callerSession(caller))] }
    }),
  call: (input, { caller }) =>
    Effect.gen(function* () {
      const settings = yield* currentSettings
      const host = yield* HostContext
      const publish = (payload: InvokePayload) =>
        Api.publish({ contract: clientBridgeApi, event: 'invoke', payload }).pipe(Effect.provideService(HostContext, host))
      return yield* runClientToolCall(input, { caller, settings, publish })
    }),
})

export default DshxPlugin.make({
  name: '@dshfiles/client-bridge',
  settings: [clientBridgeSettings],
  layer: Layer.mergeAll(ClientBridge.layer, Settings.layer(clientBridgeSettings)),
  apis: [Api.bind(clientBridgeApi, clientBridgeHandlers)],
})
