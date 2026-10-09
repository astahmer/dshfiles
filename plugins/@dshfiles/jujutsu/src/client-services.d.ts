import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** The slice of the Host shortcut registry (`@deepseek-ai/dsh-client-shortcuts`) this plugin registers one command with. */
interface ShortcutsRegistry {
  register(command: {
    readonly id: string
    readonly label: () => string
    readonly aliases: readonly string[]
    readonly defaults: Readonly<Record<string, never>>
    readonly regions: readonly ('page' | 'editable' | 'terminal')[]
    readonly modals: readonly string[]
    resolve(context: unknown): { status: 'handled'; run(): void } | { status: 'blocked'; reason: string } | { status: 'pass' }
  }): () => void
}

declare module '@dshfiles/dshx/client' {
  interface ClientServiceMap {
    shortcuts: ShortcutsRegistry
    sessions: ISessions
    uiWorkspace: UiWorkspace
    workspaces: IWorkspaces
  }
}
