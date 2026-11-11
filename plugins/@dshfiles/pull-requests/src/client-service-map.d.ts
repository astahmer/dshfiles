import type { InputTriggerSource } from '@dshfiles/input-trigger/types'

declare module '@dshfiles/dshx/client' {
  interface ClientServiceMap {
    inputTriggers: { registerSource(source: InputTriggerSource): () => void }
  }
}
