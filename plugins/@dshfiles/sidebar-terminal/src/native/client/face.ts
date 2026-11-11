/** Injected terminal commands and keyed observable state. */
import type { WebTerminalId } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { TerminalView, TerminalViewState } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { TerminalExcerpt, TerminalSelectionSource } from './excerpt.ts'
import type { TerminalExcerptTarget } from './excerpt-targets.ts'

/** The terminal's React-free model is resolved by sidebar occurrence. */
export interface TerminalInjected {
  /** @param key - sidebar occurrence key. @returns its terminal commands. */
  readonly view: (key: string) => TerminalView
  readonly keyedHooks: { readonly terminal: (key: string) => HostObservable<TerminalViewState> }
}


/** The terminal screen follows the resolved application theme through a framework hook. */
export interface TerminalBodyInjected extends TerminalInjected {
  readonly hooks: { readonly theme: HostObservable<ThemeSnapshot> }
  readonly addExcerpt: (excerpt: TerminalExcerpt) => boolean
  /** Read one xterm selection; the entry owns it so the lazy body shares no module with the entry. */
  readonly excerptOf: (source: TerminalSelectionSource) => TerminalExcerpt | undefined
  readonly registerExcerptTarget: (target: TerminalExcerptTarget) => () => void
  readonly terminalStyles: Record<string, string>
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** An existing Host terminal selected from the Session terminal list. */
    terminal: { terminalId: WebTerminalId } | { shellPath: string }
  }
}
