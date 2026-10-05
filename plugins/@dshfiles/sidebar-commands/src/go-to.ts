import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { GoToCopy } from './locales.js'

const MAX_SESSION_ROWS = 20

export type GoToTarget<SessionKey extends string> =
  | { readonly kind: 'panel'; readonly panelId: MainPanelId }
  | { readonly kind: 'session'; readonly sessionId: SessionKey }

interface GoToEntry<SessionKey extends string> {
  readonly option: SelectOption
  readonly target: GoToTarget<SessionKey>
}

interface PanelCandidate {
  readonly id: string | undefined
  readonly label: string | undefined
}

type SessionRow<SessionKey extends string> = Pick<SessionSummary, 'displayTitle' | 'cwd' | 'blank' | 'origin' | 'updatedAt'> & { readonly id: SessionKey }

interface SessionList<SessionKey extends string> {
  readonly ids: readonly SessionKey[]
  readonly byId: Readonly<Partial<Record<SessionKey, SessionRow<SessionKey>>>>
}

interface GoToInput<SessionKey extends string> {
  readonly panels: readonly PanelCandidate[]
  /** Keys registered in the `main` slot; `selectPanel` throws for any other id. */
  readonly mainPanelKeys: ReadonlySet<string>
  readonly sessions: SessionList<SessionKey> | undefined
  readonly archivedSessionIds: ReadonlySet<string>
  readonly copy: GoToCopy
}

const panelEntries = <SessionKey extends string>(input: GoToInput<SessionKey>): GoToEntry<SessionKey>[] => {
  // The slot ledger erases the brand; a panel id is a MainPanelId exactly when `main` registers it.
  const isMainPanelId = (id: string): id is MainPanelId => input.mainPanelKeys.has(id)
  const group = { name: 'panels', label: input.copy.panelsGroup }
  return input.panels
    .flatMap((panel): GoToEntry<SessionKey>[] => {
      if (panel.id === undefined || !isMainPanelId(panel.id)) return []
      const label = panel.label?.trim() ? panel.label : panel.id
      return [{ option: { id: `panel:${panel.id}`, label, detail: input.copy.panelDetail, group }, target: { kind: 'panel', panelId: panel.id } }]
    })
    .sort((left, right) => left.option.label.localeCompare(right.option.label))
}

const sessionEntries = <SessionKey extends string>(input: GoToInput<SessionKey>): GoToEntry<SessionKey>[] => {
  const sessions = input.sessions
  if (sessions === undefined) return []
  const isNavigable = (session: SessionRow<SessionKey> | undefined): session is SessionRow<SessionKey> =>
    session !== undefined && !session.blank && session.origin !== 'subagent' && !input.archivedSessionIds.has(session.id)
  const group = { name: 'sessions', label: input.copy.sessionsGroup }
  return sessions.ids
    .map(sessionId => sessions.byId[sessionId])
    .filter(isNavigable)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_SESSION_ROWS)
    .map((session): GoToEntry<SessionKey> => ({
      option: { id: `session:${session.id}`, label: session.displayTitle, detail: session.cwd ?? input.copy.sessionDetail, group },
      target: { kind: 'session', sessionId: session.id },
    }))
}

/** Panels first, alphabetically; then the most recently updated sessions a user can navigate to. */
export const buildGoToEntries = <SessionKey extends string>(input: GoToInput<SessionKey>): readonly GoToEntry<SessionKey>[] => [
  ...panelEntries(input),
  ...sessionEntries(input),
]

interface DeferredNavigation<Target> {
  readonly isAvailable: (target: Target) => boolean
  readonly unavailableMessage: (target: Target) => string
  readonly navigate: (target: Target) => void
  readonly schedule: (run: () => void) => void
}

/**
 * The shell consumes the `/goto` token and refocuses the opening Session's composer only after
 * onSelect returns. Navigating inside onSelect swaps that Session out first, so the token stays
 * in its draft. Refusals throw synchronously, where the shell shows them; navigation is scheduled.
 */
export const createDeferredNavigation =
  <Target>(navigation: DeferredNavigation<Target>) =>
  (target: Target): void => {
    if (!navigation.isAvailable(target)) throw new Error(navigation.unavailableMessage(target))
    navigation.schedule(() => navigation.navigate(target))
  }
