import { assign, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo, useRef } from 'react'

type AutoSettleContext = {
  readonly client: AutoSettleClient
  readonly enabled: boolean
  readonly intervalMs: number
  readonly refreshKey: string
}

type AutoSettleEvent = {
  readonly type: 'configure'
  readonly enabled: boolean
  readonly intervalMs: number
  readonly refreshKey: string
}

type AutoSettleInput = {
  readonly client: AutoSettleClient
  readonly intervalMs: number
  readonly refreshKey: string
}

export type AutoSettleClient = {
  readonly scan: () => void
}

const autoSettleMachineDefinition = setup({
  types: {
    // SAFETY: XState reads this erased schema only for typing; the context factory supplies runtime state.
    context: {} as AutoSettleContext,
    // SAFETY: XState reads this erased schema only for typing; callers send events through the typed machine.
    events: {} as AutoSettleEvent,
    // SAFETY: XState reads this erased schema only for typing; useAutoSettle provides the declared runtime input.
    input: {} as AutoSettleInput,
  },
  delays: {
    scanInterval: ({ context }) => context.intervalMs,
  },
  guards: {
    enablesScanning: ({ context, event }) => event.type === 'configure' && event.enabled && !context.enabled,
    disablesScanning: ({ event }) => event.type === 'configure' && !event.enabled,
    refreshesScan: ({ context, event }) =>
      event.type === 'configure' && event.enabled && (event.intervalMs !== context.intervalMs || event.refreshKey !== context.refreshKey),
  },
  actions: {
    updateConfig: assign(({ event }) => {
      if (event.type !== 'configure') return {}
      return { enabled: event.enabled, intervalMs: event.intervalMs, refreshKey: event.refreshKey }
    }),
    scan: ({ context }) => context.client.scan(),
  },
}).createMachine({
  id: 'threadSidebarAutoSettle',
  context: ({ input }) => ({
    client: input.client,
    enabled: false,
    intervalMs: input.intervalMs,
    refreshKey: input.refreshKey,
  }),
  initial: 'disabled',
  states: {
    disabled: {
      on: {
        configure: [{ guard: 'enablesScanning', target: 'scanning', actions: 'updateConfig' }, { actions: 'updateConfig' }],
      },
    },
    scanning: {
      entry: 'scan',
      always: 'waiting',
      on: {
        configure: { actions: 'updateConfig' },
      },
    },
    waiting: {
      after: {
        scanInterval: { target: 'scanning' },
      },
      on: {
        configure: [
          { guard: 'disablesScanning', target: 'disabled', actions: 'updateConfig' },
          { guard: 'refreshesScan', target: 'scanning', actions: 'updateConfig' },
          { actions: 'updateConfig' },
        ],
      },
    },
  },
})

export const autoSettleMachine = autoSettleMachineDefinition

export const useAutoSettle = (input: {
  readonly client: AutoSettleClient
  readonly enabled: boolean
  readonly intervalMs: number
  readonly refreshKey: string
}): void => {
  const latestClient = useRef(input.client)
  latestClient.current = input.client
  const client = useMemo<AutoSettleClient>(() => ({ scan: () => latestClient.current.scan() }), [])
  const [, send] = useMachine(autoSettleMachine, { input: { client, intervalMs: input.intervalMs, refreshKey: input.refreshKey } })

  useEffect(() => {
    send({ type: 'configure', enabled: input.enabled, intervalMs: input.intervalMs, refreshKey: input.refreshKey })
  }, [input.enabled, input.intervalMs, input.refreshKey, send])
}
