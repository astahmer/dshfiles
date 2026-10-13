import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

type Listener = () => void

type QuickPanelCopyKey = 'title' | 'quickPanelHint'
type TranslateQuickPanel = (key: QuickPanelCopyKey) => string

/** Session-addressed composer panel visibility shared by its trigger and overlay. */
export class QuickPanelState {
  private openState = false
  private readonly listeners = new Set<Listener>()

  readonly getSnapshot = (): boolean => this.openState

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  open(): void {
    this.set(true)
  }

  close(): void {
    this.set(false)
  }

  toggle(): void {
    this.set(!this.openState)
  }

  private set(open: boolean): void {
    if (open === this.openState) return
    this.openState = open
    for (const listener of this.listeners) listener()
  }
}

/** Keeps each mounted Session's composer menu independent from other drafts. */
export class SessionQuickPanels {
  private readonly states = new Map<string, QuickPanelState>()

  forSession(sessionId: string): QuickPanelState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = new QuickPanelState()
      this.states.set(sessionId, state)
    }
    return state
  }

  open(sessionId: string): void {
    this.forSession(sessionId).open()
  }
}

/** Native plus/slash menu action that opens the session-addressed quick panel. */
export const createQuickPanelContribution = (
  panels: SessionQuickPanels,
  translate: TranslateQuickPanel,
  icon?: ComponentType<IconProps>,
): CommandContribution => {
  return {
    name: 'mcp-servers',
    ...(icon === undefined ? {} : { icon }),
    label: () => translate('title'),
    description: () => translate('quickPanelHint'),
    available: () => true,
    ui: {
      kind: 'action',
      run: session => panels.open(session.sessionId),
    },
  }
}
