import { setup } from '@dshfiles/plugin-ui/machine'

type PairingEvent = { readonly type: 'arm' } | { readonly type: 'armed' } | { readonly type: 'arm.failed' } | { readonly type: 'paired' }

export const pairingMachine = setup({
  types: { events: {} as PairingEvent },
}).createMachine({
  id: 'annotations-pairing',
  initial: 'idle',
  states: {
    idle: { on: { arm: 'arming' } },
    arming: { on: { armed: 'armed', 'arm.failed': 'idle' } },
    armed: { on: { paired: 'paired', arm: 'arming' } },
    paired: { on: { arm: 'arming' } },
  },
})
