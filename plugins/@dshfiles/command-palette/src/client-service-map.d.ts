import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

declare module '@dshfiles/dshx/client' {
  interface ClientServiceMap {
    sessions: ISessions
  }
}
