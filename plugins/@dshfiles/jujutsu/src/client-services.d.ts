import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

declare module '@dshfiles/dshx/client' {
  interface ClientServiceMap {
    sessions: ISessions
    uiWorkspace: UiWorkspace
  }
}
