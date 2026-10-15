import { useMachine } from '@dshfiles/plugin-ui/machine'
import { secretRevealMachine, type SecretRevealClient } from './secret-reveal-machine.js'

export const useSecretReveal = (client: SecretRevealClient) => useMachine(secretRevealMachine, { input: { client } })
