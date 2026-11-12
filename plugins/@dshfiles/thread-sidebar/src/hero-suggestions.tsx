/**
 * The new-thread hero's suggestion cards (visual refresh T3.4), registered in rich-composer's
 * `conversation.hero.suggestions` slot: Resume the latest thread worth returning to, Review a thread whose work is ready
 * to land, and the Inbox count of threads that need you. They read the same sources as the thread list (the Session
 * list and the Inbox's thread signals), so they work on a phone where the list is not mounted. A card renders nothing
 * without real data.
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FileDiffIcon, InboxIcon, PlayIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo } from 'react'
import { useInboxThreadSignals } from './inbox-signals.js'
import { formatAge } from './relative-age.js'
import type { InboxThreadSignal } from './thread-status.js'

/** One top-level thread, as far as the cards need it. */
export interface HeroThreadRow {
  readonly id: string
  readonly title: string
  readonly blank: boolean
  readonly running: boolean
  readonly activityAt: number
  /** The Inbox's most urgent open item about this thread, if any. */
  readonly signal: InboxThreadSignal | undefined
  /** The thread's folder, for the Changes view of a ready thread. */
  readonly cwd: string | undefined
}

export interface HeroSuggestions {
  readonly resume: { readonly id: string; readonly title: string; readonly at: number } | undefined
  readonly review: { readonly id: string; readonly title: string; readonly cwd: string | undefined } | undefined
  /** Threads that need you (questions, approvals, resumes). */
  readonly inbox: number
}

const needsYou = (signal: InboxThreadSignal | undefined): boolean => signal?.severity === 'blocking'

/**
 * Pick the cards.
 * - Review: the most recently active thread whose Inbox item offers Land.
 * - Resume: a thread whose Inbox item offers Resume first, then the most recently active quiet thread; never a
 *   running or blank thread, the hero's own thread, or the Review thread.
 * - Inbox: how many threads need you.
 */
const pick = (rows: readonly HeroThreadRow[], heroSessionId: string | undefined): HeroSuggestions => {
  const candidates = rows.filter(row => !row.blank && row.id !== heroSessionId)
  const newest = (list: readonly HeroThreadRow[]): HeroThreadRow | undefined =>
    list.reduce<HeroThreadRow | undefined>((best, row) => (best === undefined || row.activityAt > best.activityAt ? row : best), undefined)
  const review = newest(candidates.filter(row => row.signal?.verb === 'Land'))
  const others = candidates.filter(row => row.id !== review?.id && !row.running)
  const resume = newest(others.filter(row => row.signal?.verb === 'Resume')) ?? newest(others.filter(row => row.signal === undefined))
  return {
    resume: resume === undefined ? undefined : { id: resume.id, title: resume.title, at: resume.activityAt },
    review: review === undefined ? undefined : { id: review.id, title: review.title, cwd: review.cwd },
    inbox: candidates.filter(row => needsYou(row.signal)).length,
  }
}

type SessionsState = Parameters<Parameters<PropsRuntime<'root'>['useSessions']>[0]>[0]

/** Top-level threads of the Session list with their Inbox signal. */
const rowsOf = (state: SessionsState, signals: ReadonlyMap<string, InboxThreadSignal>): readonly HeroThreadRow[] =>
  state.ids.flatMap(id => {
    const session = state.byId[id]
    if (session === undefined || session.parentId !== undefined) return []
    return [
      {
        id,
        title: session.title ?? session.displayTitle,
        blank: session.blank,
        running: session.running,
        activityAt: session.updatedAt,
        signal: signals.get(id),
        cwd: session.cwd === undefined || session.cwd === '' ? undefined : session.cwd,
      },
    ]
  })

export interface HeroSuggestionActions {
  /** Open a thread on the stage. */
  readonly open: (sessionId: string) => void
  /** Open a ready thread's work in the Changes view; false when no Changes owner is loaded. */
  readonly review: (input: { readonly sessionId: string; readonly workspacePath: string }) => boolean
  /** Show the Inbox destination. */
  readonly openInbox: () => void
}

// Flat cards on a hairline (the composer stays the only elevated object); 48pt rows on touch.
const CARD =
  'dshx-root dshx:inline-flex dshx:h-9 dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-transparent dshx:px-3 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-12 dshx:pointer-coarse:text-base dshx:[&_svg]:size-4 dshx:[&_svg]:flex-none'

/** The cards for one hero; nothing when no card has real data. */
export const HeroSuggestionCards = (props: {
  readonly heroSessionId: string | undefined
  readonly useSessions: PropsRuntime<'root'>['useSessions']
  readonly actions: HeroSuggestionActions
  readonly now: () => number
}): JSX.Element | null => {
  const sessions = props.useSessions(state => state)
  const inbox = useInboxThreadSignals({ enabled: true })
  const suggestions = useMemo(() => pick(rowsOf(sessions, inbox.signals), props.heroSessionId), [sessions, inbox.signals, props.heroSessionId])
  const cards: JSX.Element[] = []
  if (suggestions.resume !== undefined) {
    const resume = suggestions.resume
    cards.push(
      <button key="resume" type="button" className={CARD} data-hero-card="resume" onClick={() => props.actions.open(resume.id)}>
        <PlayIcon aria-hidden="true" />
        <span className="dshx:font-medium dshx:text-foreground">Resume</span>
        <span aria-hidden="true">·</span>
        <span className="dshx:min-w-0 dshx:truncate">{resume.title}</span>
        <span aria-hidden="true">·</span>
        <span className="dshx:flex-none dshx:tabular-nums">{formatAge(resume.at, props.now())}</span>
      </button>,
    )
  }
  if (suggestions.review !== undefined) {
    const review = suggestions.review
    cards.push(
      <button
        key="review"
        type="button"
        className={CARD}
        data-hero-card="review"
        onClick={() => {
          props.actions.open(review.id)
          if (review.cwd !== undefined) props.actions.review({ sessionId: review.id, workspacePath: review.cwd })
        }}
      >
        <FileDiffIcon aria-hidden="true" />
        <span className="dshx:font-medium dshx:text-foreground">Review</span>
        <span aria-hidden="true">·</span>
        <span className="dshx:min-w-0 dshx:truncate">{review.title}</span>
        <span aria-hidden="true">·</span>
        <span className="dshx:flex-none">ready to land</span>
      </button>,
    )
  }
  if (suggestions.inbox > 0) {
    const count = suggestions.inbox
    cards.push(
      <button key="inbox" type="button" className={CARD} data-hero-card="inbox" onClick={props.actions.openInbox}>
        <InboxIcon aria-hidden="true" />
        <span className="dshx:font-medium dshx:text-foreground">Inbox</span>
        <span aria-hidden="true">·</span>
        <span className="dshx:flex-none dshx:tabular-nums">{count === 1 ? '1 thread needs you' : `${count} threads need you`}</span>
      </button>,
    )
  }
  return cards.length === 0 ? null : <>{cards}</>
}

export class HeroSuggestionsModel {
  static readonly pick = pick
  static readonly rowsOf = rowsOf
}
