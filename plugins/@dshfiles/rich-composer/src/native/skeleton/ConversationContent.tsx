import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconFolderOpenRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronDownIcon } from '@dshfiles/plugin-ui/icons'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { ConversationContentProps, ConversationViewsProps } from '../contract/slots.ts'
import { HeroShell, WorkspaceChip, workspaceLabel } from './EmptyHero.tsx'
import { ConversationWidthControls } from './ConversationWidthControls.tsx'
import { confirmedRemoteWorkspaceCwd } from '../../remote-workspace-context.ts'
import { AgentPresetVisibility } from '../../agent-preset-visibility.ts'
import css from './ConversationRoot.module.css'

function ConversationSessionView({ renderSlot }: ConversationViewsProps) {
  return renderSlot('conversation.session', {})
}

function NoConversationWidthControls() {
  return null
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
  const workspaces = useWorkspaces(s => s)
  // A plugin this package cannot import (ui-model-selection) says this session cannot
  // send; its reason is already localized by whoever raised it.
  const composerBlock = useComposerBlock(block => block)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<WorkspaceId | undefined>()
  const pickerAnchor = useRef<HTMLButtonElement>(null)
  const agentPresetShown = useSyncExternalStore(AgentPresetVisibility.subscribe, AgentPresetVisibility.get, AgentPresetVisibility.get)
  // b:4qjm: on a phone the project, host and workspace pickers fold into one chip that opens a panel holding all three.
  const [placeOpen, setPlaceOpen] = useState(false)
  const placeRef = useRef<HTMLSpanElement>(null)
  const placeText = useRunPlaceText(placeRef)
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
      if (event.key === 'Escape' && !event.defaultPrevented) setPlaceOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape)
    }
  }, [placeOpen])

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
      const seatHeight = `${seat.offsetHeight}px`
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
      {/* b:4qjm: one group for where the thread runs. Wide bars lay its pickers out in the row as before; a phone bar shows
          one "sample · In the project" chip on its own line, opening a panel with the three pickers. */}
      <span className={css.runPlace} data-run-place="" data-place-open={placeOpen ? '' : undefined} data-row-break="" ref={placeRef}>
        <button
          type="button"
          className={css.placeSummary}
          aria-expanded={placeOpen}
          aria-label={t('runRow.placeSummary', { place: placeText ?? chipTitle ?? t('runRow.project') })}
          onClick={() => { setPlaceOpen(open => !open) }}
          data-place-summary=""
        >
          <IconFolderOpenRegular size={13} aria-hidden />
          <span className={css.runSummaryText}>{placeText ?? chipTitle ?? t('runRow.project')}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
        <span className={css.placeSheet} role="group" aria-label={t('runRow.placeSheet')} data-place-sheet="">
          <span className={css.placeHeading} aria-hidden>{t('runRow.placeSheet')}</span>
          <span className={css.placeLabel} data-place-label="project" aria-hidden>{t('runRow.placeProject')}</span>
          <span className={css.placeLabel} data-place-label="host" aria-hidden>{t('runRow.placeHost')}</span>
          <span className={css.placeLabel} data-place-label="workspace" aria-hidden>{t('runRow.placeWorkspace')}</span>
      <span className={css.runProject} data-run-segment="project" data-thread-workspace={threadWorkspaceName}>
        <Tooltip label={t('runRow.project')} side="top" delayMs={400} disabled={pickerOpen}>
          <WorkspaceChip
            buttonRef={pickerAnchor}
            label={chipTitle}
            menuOpen={pickerOpen}
            onClick={() => { setPickerOpen(open => !open) }}
            t={t}
          />
        </Tooltip>
      </span>
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
          <button type="button" className={css.placeDone} onClick={() => { setPlaceOpen(false) }}>{t('runRow.placeDone')}</button>
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
    <Tooltip label={t('runRow.summary', { project: chipTitle, host: summaryHost })} side="top" delayMs={400}>
      <span className={css.runSummary} tabIndex={0} data-run-summary="" data-thread-workspace={threadWorkspaceName}>
        <IconFolderOpenRegular size={13} aria-hidden />
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
    <div className={clsx(css.composerStack, hero && css.composerHero)}>
      {hero && <HeroShell t={t} project={chipTitle} />}
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
      <div className={css.scrollBody} data-conversation-scroll="">
        {sessionId === undefined ? null : <Views />}
        {composerSeat}
      </div>
      <WidthControls container={body} phase={phase} />
    </div>
  )
}

/**
 * "sample · In the project": what the project, host and workspace pickers in the place group say now, read
 * from their own segments (b:4qjm) so each owner keeps its state. Undefined until a segment has text.
 * @param ref - the place group.
 * @returns the joined text.
 */
function useRunPlaceText(ref: { readonly current: HTMLElement | null }): string | undefined {
  const [text, setText] = useState<string | undefined>(undefined)
  useEffect(() => {
    const place = ref.current
    if (place === null) return
    const read = (): void => {
      const parts = ['project', 'host', 'workspace'].flatMap(segment => {
        const element = place.querySelector(`[data-run-segment="${segment}"]`)
        // b:212a: "sample · Own workspace": this machine is the default, so only a remote host is named.
        if (segment === 'host' && element?.getAttribute('data-host-kind') === 'local') return []
        const value = element?.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
        return value === '' ? [] : [value]
      })
      const next = parts.length === 0 ? undefined : parts.join(' · ')
      setText(current => (current === next ? current : next))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(place, { subtree: true, childList: true, characterData: true })
    return () => { observer.disconnect() }
  }, [ref])
  return text
}
