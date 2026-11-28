import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronDownIcon, FolderIcon, LaptopIcon, ServerIcon } from '@dshfiles/plugin-ui/icons'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { ConversationContentProps, ConversationViewsProps } from '../contract/slots.ts'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import { ConversationWidthControls } from './ConversationWidthControls.tsx'
import { confirmedRemoteWorkspaceCwd } from '../../remote-workspace-context.ts'
import { AgentPresetVisibility } from '../../agent-preset-visibility.ts'
import { LiveWork, PhoneDockHead, useLiveWorkCounts } from '../../live-work.tsx'
import css from './ConversationRoot.module.css'

function ConversationSessionView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', {})
}

function NoConversationWidthControls() {
  return null
}

/** How many parents a child thread's project is looked up through. */
const LINEAGE_DEPTH = 8

/**
 * A thread's ancestors, nearest first: its parent, the parent's parent, and so on, up to eight, stopping at a cycle.
 * @param sessionId - The thread whose ancestors are read.
 * @param byId - The session list's summaries.
 * @returns The ancestor ids, nearest first.
 */
export function ancestorsOf<Id extends string>(sessionId: Id, byId: Partial<Readonly<Record<Id, { readonly parentId?: Id | undefined }>>>): Id[] {
  const ids: Id[] = []
  const seen = new Set<Id>([sessionId])
  let parent = byId[sessionId]?.parentId
  while (parent !== undefined && ids.length < LINEAGE_DEPTH && !seen.has(parent)) {
    ids.push(parent)
    seen.add(parent)
    parent = byId[parent]?.parentId
  }
  return ids
}

/** The workspace of the nearest ancestor in `lineage` (ids joined by newlines) that has one. */
function workspaceOfLineage<Workspace extends { readonly sessionIds: readonly string[] }>(lineage: string, items: readonly Workspace[]): Workspace | undefined {
  if (lineage === '') return undefined
  for (const id of lineage.split('\n')) {
    const found = items.find(workspace => workspace.sessionIds.includes(id))
    if (found !== undefined) return found
  }
  return undefined
}

interface ComposerInputDockProps {
  readonly session: SessionSnapshot
  readonly useInput: ConversationContentProps['useInput']
  readonly renderSlot: ConversationContentProps['renderSlot']
}

/**
 * The dock seats' live InputZone. Subscribing to the input state here keeps a
 * composer publication (every draft keystroke) from re-rendering the
 * Conversation body and the View it holds.
 */
const ComposerInputDock = ({ session, useInput, renderSlot }: ComposerInputDockProps): ReactNode => {
  const inputState = useInput(state => state)
  if (inputState === undefined) return null
  return renderSlot('conversation.input.dock', { session, input: inputState })
}

/**
 * Render the shared Conversation body and its occurrence-selected local Components.
 * @param props - Factory input, standard Session sources, and Conversation seats.
 * @returns the Conversation view, Composer, and optional width controls.
 */
export function ConversationContent(props: ConversationContentProps) {
  const {
    sessionId, phase, hero, useSession, useSessions, useSessionStatus,
    useWorkspaces, useInput, useComposerBlock, useDraftWorkspace, useRemoteWorkspace,
    resolveRemoteWorkspace, renderSlot, renderSlotChain, selectWorkspace, t, useFactorySlot,
  } = props
  const session = useSession(snapshot => snapshot)
  const Views = useFactorySlot('views', ConversationSessionView)
  const WidthControls = useFactorySlot('widthControls', props.variant === 'main' ? ConversationWidthControls : NoConversationWidthControls)
  const [body, setBody] = useState<HTMLDivElement | null>(null)
  const pendingInteraction = useSessionStatus(snapshot =>
    sessionId === undefined ? undefined : snapshot.get(sessionId)?.pendingInteraction)
  const cwd = useSessions(s => sessionId === undefined ? undefined : s.byId[sessionId]?.cwd)
  // Council round 34 B7: a subagent's thread is in no workspace's sessionIds, so it takes its nearest ancestor's project,
  // as the thread list does (thread-sidebar's workspaceForLineage). Joined ids, so the subscription keeps its identity.
  const lineage = useSessions(s => sessionId === undefined ? '' : ancestorsOf(sessionId, s.byId).join('\n'))
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  const agentPresetShown = useSyncExternalStore(AgentPresetVisibility.subscribe, AgentPresetVisibility.get, AgentPresetVisibility.get)
  // Council round 16 C1 (b:4qjm): the host and working-location pickers fold into ONE location chip on every width; it
  // opens a panel in the card holding both. The project chip stays its own control beside it.
  const [placeOpen, setPlaceOpen] = useState(false)
  const placeRef = useRef<HTMLSpanElement>(null)
  const placeSummaryRef = useRef<HTMLButtonElement>(null)
  const placeSheetId = useId()
  const { place, alert: placeAlert } = useRunPlaceText(placeRef)
  const closePlace = useCallback((): void => {
    // Focus inside the panel returns to the chip that opened it, so a keyboard user is not dropped on the page.
    if (placeRef.current?.contains(document.activeElement) === true) placeSummaryRef.current?.focus()
    setPlaceOpen(false)
  }, [])
  // Unslop r5 C1: below 28rem the dock's jobs and subagents fold into one Live work row; open per thread.
  const stackRef = useRef<HTMLDivElement>(null)
  const liveWork = useLiveWorkCounts(stackRef)
  const [liveWorkOpenFor, setLiveWorkOpenFor] = useState<string | undefined>(undefined)
  const liveWorkOpen = sessionId !== undefined && liveWorkOpenFor === sessionId
  useEffect(() => {
    if (!placeOpen) return
    const place = placeRef.current
    const close = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node) || place === null || place.contains(target)) return
      // A picker opened from the panel portals its menu to the page; using it keeps the panel open.
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]') !== null) return
      setPlaceOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) closePlace()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape)
    }
  }, [placeOpen, closePlace])

  // Publishes the two live measurements floating View chrome reads off the
  // scroll body: the seat's height as --dsh-composer-height, so controls clear
  // the composer as it grows, and the scrollport's own height as
  // --dsh-conversation-viewport-height, so a control can sit in the band the
  // seat leaves visible. Callback ref, not an effect; stable identity prevents
  // observer churn while the first blank session fills the resident body
  // outlet.
  const seatObserver = useRef<ResizeObserver | null>(null)
  const seatResizeRef = useCallback((seat: HTMLDivElement | null): void => {
    seatObserver.current?.disconnect()
    seatObserver.current = null
    const scroller = seat?.parentElement ?? null
    if (seat === null || scroller === null) return
    seatObserver.current = new ResizeObserver(() => {
      // Both reads before either write: a write between them forces a second layout of the whole conversation.
      // The phone seat's top pad is a clear band above the dock, where the transcript's fade ends: a floating control
      // (Chat's Back to bottom) clears the dock itself by its 12px, not the band (council round 35 P7).
      const band = Number.parseFloat(getComputedStyle(seat).paddingTop) || 0
      const seatHeight = `${seat.offsetHeight - band}px`
      const viewportHeight = `${scroller.clientHeight}px`
      if (scroller.style.getPropertyValue('--dsh-composer-height') !== seatHeight) scroller.style.setProperty('--dsh-composer-height', seatHeight)
      if (scroller.style.getPropertyValue('--dsh-conversation-viewport-height') !== viewportHeight) {
        scroller.style.setProperty('--dsh-conversation-viewport-height', viewportHeight)
      }
    })
    seatObserver.current.observe(seat)
    seatObserver.current.observe(scroller)
  }, [])

  const draftWorkspaceId = useDraftWorkspace(id => id)
  const remoteWorkspace = useRemoteWorkspace(ownership => ownership)
  const sessionWorkspace = sessionId === undefined
    ? undefined
    : workspaces.items.find(workspace => workspace.sessionIds.includes(sessionId))
      ?? workspaceOfLineage(lineage, workspaces.items)
      ?? workspaces.items.find(workspace => workspace.workspaceId === draftWorkspaceId)
  const pendingWorkspace = workspaces.items.find(
    workspace => workspace.workspaceId === pendingWorkspaceId,
  )

  // Clear the pending pick once the session lands in it, or when the picked
  // workspace disappears from a ready list (deleted from the sidebar).
  useEffect(() => {
    if (pendingWorkspaceId === undefined) return
    if (sessionWorkspace?.workspaceId === pendingWorkspaceId
      || (workspaces.phase === 'ready' && pendingWorkspace === undefined)) {
      setPendingWorkspaceId(undefined)
    }
  }, [pendingWorkspaceId, sessionWorkspace?.workspaceId, workspaces.phase, pendingWorkspace])

  useEffect(() => {
    if (
      !hero || sessionId === undefined || sessionWorkspace !== undefined || cwd === undefined || cwd === '' ||
      remoteWorkspace !== undefined
    ) return
    void resolveRemoteWorkspace()
  }, [hero, sessionId, sessionWorkspace?.workspaceId, cwd, remoteWorkspace, resolveRemoteWorkspace])

  const remoteWorkspaceCwd = confirmedRemoteWorkspaceCwd({ ownership: remoteWorkspace, cwd })
  const remoteWorkspaceTitle = remoteWorkspaceCwd === undefined ? undefined : workspaceLabel(remoteWorkspaceCwd)

  // b:212a: a thread's own jj workspace is a detail of the thread, so the chip names the project it was cut from (its
  // registered title, else the part before " · "), never "sample · thread-e4fde2"; the folder rides on a data attribute.
  const projectTitleOf = (workspace: { readonly path: string; readonly title: string } | undefined): string | undefined => {
    if (workspace === undefined || !EntityLabels.isThreadWorkspace(workspace.path)) return workspace?.title
    const repositoryPath = EntityLabels.repositoryPath(workspace.path)
    const project = workspaces.items.find(item => item.path.replace(/\/+$/u, '') === repositoryPath)
    return project?.title ?? (workspace.title.split(' · ')[0]?.trim() || workspace.title)
  }
  const chipWorkspace = pendingWorkspace ?? (sessionId === undefined ? undefined : sessionWorkspace)
  const threadWorkspaceName = chipWorkspace !== undefined && EntityLabels.isThreadWorkspace(chipWorkspace.path)
    ? chipWorkspace.path.replace(/\/+$/u, '').split('/').at(-1)
    : undefined

  // The chip is a selector; a confirmed remote Session uses its own cwd instead
  // of pretending its path belongs to the manager's local Workspace list.
  // A title still automatic reads in the reader's language, matching the
  // sidebar row the same Workspace has there.
  const storedChipTitle = projectTitleOf(pendingWorkspace)
    ?? (sessionId === undefined
      ? undefined
      : projectTitleOf(sessionWorkspace)
        ?? remoteWorkspaceTitle
        ?? (workspaces.phase === 'ready' || cwd === undefined || cwd === ''
          ? undefined
          : workspaceLabel(cwd)))
  const chipTitle = storedChipTitle === undefined
    ? undefined
    : workspaceDisplayTitle(storedChipTitle, t('workspace.defaultName'))

  // The run row's leading segments (docs/ade-ux §4.5): project · host · workspace (the hero.workspace occupant, which
  // leads with its host chip) · agent mode · plugin options. The bar appends File access and Model + account. Each
  // owner keeps its own state; this row only places their slots, so a missing owner just drops its segment.
  const heroWorkspaceRow = (
    <>
      {/* b:4qjm, council round 16 C1: one group for where the thread runs. The project chip leads it; the host and the
          working location fold into one location chip ("Local", plus a detail only when either differs from the
          default) that opens a panel with both pickers. A phone bar gives the group a line of its own. */}
      {/* A picker's error (an unreadable destination, a failed switch) never waits behind the closed chip: the panel opens. */}
      <span className={css.runPlace} data-run-place="" data-place-open={placeOpen || placeAlert ? '' : undefined} data-row-break="" ref={placeRef}>
      <span className={css.runProject} data-run-segment="project" data-thread-workspace={threadWorkspaceName}>
        {/* Unslop r5 C5: the project's identity tile, the one the thread list and tabs draw, beside the chip rather than
            in it, so the chip's text stays the project's name (scratch seeding and journeys read it). */}
        {chipTitle === undefined ? null : <ProjectMark name={chipTitle} size="dense" />}
        <Tooltip label={t('runRow.project')} side="top" delayMs={400} disabled={pickerOpen} portal>
          <WorkspaceChip
            buttonRef={pickerAnchor}
            label={chipTitle}
            marked={chipTitle !== undefined}
            menuOpen={pickerOpen}
            onClick={() => { setPickerOpen(open => !open) }}
            t={t}
          />
        </Tooltip>
      </span>
        <button
          ref={placeSummaryRef}
          type="button"
          className={clsx(css.placeSummary, 'dshx-hit-44')}
          aria-expanded={placeOpen || placeAlert}
          aria-controls={placeSheetId}
          // The name says every part ("Local · In the project"); the chip shows only what differs from the default.
          aria-label={t('runRow.placeSummary', { place: place?.full ?? '' })}
          onClick={() => { if (placeOpen || placeAlert) closePlace(); else setPlaceOpen(true) }}
          data-place-summary=""
          data-run-segment="location"
          data-place-empty={place === undefined ? '' : undefined}
        >
          {place?.host === 'remote' ? <ServerIcon size={14} aria-hidden /> : place?.host === 'local' ? <LaptopIcon size={14} aria-hidden /> : <FolderIcon size={14} aria-hidden />}
          <span className={css.runSummaryText}>{place?.shown}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
        <span className={css.placeSheet} id={placeSheetId} role="group" aria-label={t('runRow.placeSheet')} data-place-sheet="">
          <span className={css.placeHeading} aria-hidden>{t('runRow.placeSheet')}</span>
          <span className={css.placeLabel} data-place-label="host" aria-hidden>{t('runRow.placeHost')}</span>
          <span className={css.placeLabel} data-place-label="workspace" aria-hidden>{t('runRow.placeWorkspace')}</span>
      {renderSlot('conversation.hero.workspace', {
        open: pickerOpen,
        anchorRef: pickerAnchor,
        selectedId: pendingWorkspaceId ?? sessionWorkspace?.workspaceId,
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
        onClose: () => { setPickerOpen(false) },
      })}
          <button type="button" className={css.placeDone} onClick={closePlace}>{t('runRow.placeDone')}</button>
        </span>
      </span>
      {/* b:4v6p: unless Settings always shows it, the picker hides while the draft keeps the default agent mode. */}
      <span className={css.runSegment} data-run-segment="agent-mode" data-agent-quiet={agentPresetShown ? undefined : ''}>
        {renderSlot('conversation.hero.agentPreset', {})}
      </span>
      {sessionId === undefined ? null : <div className={css.heroOptions} data-hero-options="">{renderSlot('conversation.hero.options', {})}</div>}
    </>
  )

  // Once the thread has started, the run row collapses to one summary chip leading the meter line. Memoized on its
  // text so streaming Session updates keep the memoized bar from re-rendering.
  // b:212a: the summary reads "sample · Own workspace · 1 ahead of main" with the location entry beside it; this
  // machine is the default, so only a remote host is named ("Local" stays in the tooltip).
  const summaryHost = remoteWorkspaceCwd === undefined ? t('runRow.summaryLocal') : t('runRow.summaryRemote')
  const runSummary = useMemo(() => chipTitle === undefined ? undefined : (
    <Tooltip label={t('runRow.summary', { project: chipTitle, host: summaryHost })} side="top" delayMs={400} portal>
      <span className={css.runSummary} tabIndex={0} data-run-summary="" data-thread-workspace={threadWorkspaceName}>
        {/* Unslop r5 C5: the project's identity tile, the one the thread list and tabs draw, instead of a folder. */}
        <ProjectMark name={chipTitle} size="dense" />
        <span className={css.runSummaryText}>{chipTitle}</span>
        {remoteWorkspaceCwd === undefined ? null : (
          <>
            <span aria-hidden>·</span>
            <span className={css.runSummaryText}>{summaryHost}</span>
          </>
        )}
      </span>
    </Tooltip>
  ), [chipTitle, remoteWorkspaceCwd, summaryHost, t, threadWorkspaceName])

  // The placeholder chip ("Choose project") and Workspace-trigger input travel
  // together for a cold start or an unowned blank Session. Confirmed remote
  // Sessions get the same composer without claiming a manager-local Workspace.
  // bar is ONE session-maybe slot rendered unconditionally — inert is a prop,
  // not a different tree, so the textarea DOM survives the transition.
  const inert = sessionId === undefined || (hero && chipTitle === undefined)
  // A raised block is the same inert posture with the blocker's own reason:
  // one disabled textarea, never a second tree. The no-workspace state wins
  // when both hold — picking a workspace is the earlier prerequisite.
  const blocked = !inert && composerBlock !== undefined
  const inputBar = renderSlot('conversation.composer.bar', {
    variant: hero ? 'hero' : 'composer',
    occurrence: props.variant,
    ...(inert
      ? {
        disabled: true,
        placeholder: t('placeholder.workspace'),
        workspacePickerOpen: pickerOpen,
        onRequestWorkspace: () => { setPickerOpen(true) },
      }
      : blocked
        // `blocked`, not `disabled`: the bar refuses input either way, but a
        // block keeps the model seat live because choosing a model is how the
        // user clears it.
        ? { blocked: composerBlock, placeholder: composerBlock.reason }
        : hero ? { placeholder: t('placeholder.hero') } : {}),
    ...(hero ? { runRow: heroWorkspaceRow } : runSummary === undefined ? {} : { runSummary }),
  })

  // Visual refresh T3.4: a calm headline that names the project, the composer, then the suggestion cards (Resume /
  // Review / Inbox) their owners fill from real data; each card renders nothing without data. On a phone the cards
  // move above the composer, which sits on the keyboard (ConversationRoot.module.css).
  const composerBar = (
    <div ref={stackRef} className={clsx(css.composerStack, hero && css.composerHero)} data-live-work-open={liveWorkOpen ? '' : undefined}>
      {hero && <HeroShell t={t} project={chipTitle} />}
      {/* Unslop r5 C1 (council round 4): the phone dock's head row holds Live work (round 35 P7: no jump control seat). */}
      {session !== undefined && (
        <PhoneDockHead
          className={css.dockHead}
          summaryClassName={css.liveWork}
          counts={liveWork}
          open={liveWorkOpen}
          onToggle={() => { setLiveWorkOpenFor(liveWorkOpen ? undefined : sessionId) }}
          label={t('liveWork.label')}
          detail={LiveWork.detail(liveWork, t)}
        />
      )}
      {session !== undefined && <ComposerInputDock session={session} useInput={useInput} renderSlot={renderSlot} />}
      {inputBar}
      {hero && (
        <div className={css.heroSuggestions} role="group" aria-label={t('hero.suggestions')} data-hero-suggestions="">
          {renderSlot('conversation.hero.suggestions', { heroSessionId: sessionId })}
        </div>
      )}
    </div>
  )

  const composer = renderSlotChain(
    'conversation.composer',
    { sessionId, session, pendingInteraction },
    { fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true },
  )

  // Sticky wraps the whole chain output (fallback + elected overlay), not
  // only `.composerStack`: overlay:true renders those as siblings, and sticky
  // on the fallback alone would leave a business-owned takeover at the content
  // end off-screen when the user is not pinned to the floor.
  const composerSeat = (
    <div ref={seatResizeRef} className={css.composerSeat} data-composer-seat="" data-conversation-region="composer">
      {composer}
    </div>
  )

  return (
    <div
      ref={setBody}
      className={clsx(css.body, props.variant === 'embedded' && css.embeddedBody)}
      data-conversation-content=""
      data-conversation-session={sessionId}
      data-conversation-region="chat"
      data-content-phase={phase}
    >
      {/* The frame wraps the scroll body in every phase, so leaving the home keeps the composer mounted. */}
      {renderSlot('conversation.hero.frame', { hero: hero && props.variant !== 'embedded' }, {
        children: (
          <div className={css.scrollBody} data-conversation-scroll="">
            {sessionId === undefined ? null : <Views />}
            {composerSeat}
          </div>
        ),
      })}
      <WidthControls container={body} phase={phase} />
    </div>
  )
}

/** A segment's text without a project mark's letters (unslop r5 C5): "billing-api", never "BAbilling-api". */
export function textWithoutMarks(element: Element | null): string {
  if (element === null) return ''
  if (element.querySelector('[data-slot="project-mark"]') === null) return element.textContent ?? ''
  const copy = element.cloneNode(true)
  if (!(copy instanceof Element)) return element.textContent ?? ''
  for (const mark of copy.querySelectorAll('[data-slot="project-mark"]')) mark.remove()
  return copy.textContent ?? ''
}

/** What the location chip says (council round 16 C1): every part for its name, the non-default ones on the chip. */
export interface RunPlace {
  /** "Local · In the project": the host, a remote folder and the working location, for the chip's accessible name. */
  readonly full: string
  /** "Local", or "Local · Own workspace from main" once the working location differs from its default. */
  readonly shown: string
  /** Which glyph leads the chip; undefined when no host picker is installed. */
  readonly host: 'local' | 'remote' | undefined
}

/** A picker's words with a space between its parts ("Own workspace" + "from main"), never "Own workspacefrom main". */
const segmentText = (element: Element | null): string => {
  if (element === null) return ''
  const parts = Array.from(element.childNodes, node => {
    if (!(node instanceof Element)) return node.textContent ?? ''
    return node.getAttribute('data-slot') === 'project-mark' ? '' : textWithoutMarks(node)
  })
  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

/**
 * Read the place group's host and working-location pickers from their own segments (b:4qjm), so each owner keeps its
 * state: multi-host's host chip (`data-host-kind`), jj-integration's workspace segment (`data-location-default` while it
 * keeps the project's default) and a remote host's folder chip. The chip names the host, and the working location only
 * when it differs from the default, or when no host picker could name the place.
 * @param place - the place group.
 * @returns the chip's words, or undefined when neither picker is installed.
 */
export function readRunPlace(place: Element): RunPlace | undefined {
  const host = place.querySelector('[data-run-segment="host"]')
  const workspace = place.querySelector('[data-run-segment="workspace"]')
  const hostText = segmentText(host)
  const folderText = segmentText(place.querySelector('[data-remote-folder]'))
  const workspaceText = segmentText(workspace)
  const full = [hostText, folderText, workspaceText].filter(part => part !== '')
  if (full.length === 0) return undefined
  const quietWorkspace = hostText !== '' && workspace?.hasAttribute('data-location-default') === true
  const shown = [hostText, folderText, quietWorkspace ? '' : workspaceText].filter(part => part !== '')
  const hostKind = host === null ? undefined : host.getAttribute('data-host-kind') === 'local' ? 'local' : 'remote'
  return { full: full.join(' · '), shown: shown.join(' · '), host: hostKind }
}

const samePlace = (left: RunPlace | undefined, right: RunPlace | undefined): boolean =>
  left === right || (left !== undefined && right !== undefined && left.full === right.full && left.shown === right.shown && left.host === right.host)

/**
 * The location chip's words, kept current as the pickers in the place group change (text, a host switch, a workspace
 * choice), and whether a picker in its panel shows an error. Undefined words until a picker has text.
 * @param ref - the place group.
 * @returns what the chip says, and whether the panel holds an alert.
 */
function useRunPlaceText(ref: { readonly current: HTMLElement | null }): { readonly place: RunPlace | undefined; readonly alert: boolean } {
  const [text, setText] = useState<RunPlace | undefined>(undefined)
  const [alert, setAlert] = useState(false)
  useEffect(() => {
    const place = ref.current
    if (place === null) return
    const read = (): void => {
      const next = readRunPlace(place)
      setText(current => (samePlace(current, next) ? current : next))
      setAlert(place.querySelector('[data-place-sheet] [role="alert"]') !== null)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(place, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-host-kind', 'data-location-default'],
    })
    return () => { observer.disconnect() }
  }, [ref])
  return { place: text, alert }
}
