import { useMachine } from '@dshfiles/plugin-ui/machine'
import { provideRestartMachine, type RestartClient } from './restart-machine.js'

const restartMachineWithClient = provideRestartMachine()

export const useRestartMachine = (client: RestartClient) => useMachine(restartMachineWithClient, { input: { client } })
