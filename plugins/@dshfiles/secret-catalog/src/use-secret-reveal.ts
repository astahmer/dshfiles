import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useMemo } from 'react'
import { createSecretRevealActor, secretRevealMachine, type SecretRevealClient } from './secret-reveal-machine.js'

export const useSecretReveal = (client: SecretRevealClient) => {
  const machine = useMemo(() => secretRevealMachine.provide({ actors: { revealSecret: createSecretRevealActor(client) } }), [client])
  return useMachine(machine)
}
