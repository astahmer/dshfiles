import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ExternalLinkIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { destinationLabel } from './getting-started-page.js'
import { PHONE_QUERY, ReachModel, type FeatureReach, type WalkStep } from './reach-model.js'
import { Routes, type RouteServices } from './routes.js'
import { createWalk, type WalkController, type WalkSnapshot } from './walk-controller.js'

/**
 * The walk's card: a popover-layer surface (12px radius, s2) pinned to a viewport edge. Both insets are set and the width
 * is capped, so it is the full width minus a margin on a phone and a 24rem card at the right edge elsewhere, with no
 * viewport breakpoint. It stays non-modal: the user clicks the ringed control behind it.
 */
export const WALK_CARD =
  'dshx:pointer-events-auto dshx:fixed dshx:inset-x-2 dshx:ml-auto dshx:flex dshx:max-w-96 dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-s2'

/** Host modals sit at 1000: the ring and card stay under them unless the target itself lives in a higher layer. */
const BELOW_MODALS = 999
/** The walk card's own layer when no ringed control lifts it. */
export const WALK_LAYER = BELOW_MODALS
const RING_GAP = 4

export interface ShowMeWhereProps {
  readonly reach: FeatureReach
  readonly routes: RouteServices
  readonly onEnd: () => void
  readonly document?: Document
  readonly isVisible?: (element: Element) => boolean
  readonly missingAfterMs?: number
}

const layerOf = (element: Element): number => {
  const view = element.ownerDocument.defaultView
  let layer = 0
  for (let node: Element | null = element; node !== null && view !== null; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    const z = Number.parseInt(style.zIndex, 10)
    if (style.position !== 'static' && Number.isFinite(z)) layer = Math.max(layer, z)
  }
  return layer
}

const targetLabel = (step: WalkStep): string => (step.locator === null ? '' : `${ReachModel.locatorLabel(step.locator)} "${step.locator.name}"`)

const chipText = (input: { readonly snapshot: WalkSnapshot; readonly steps: readonly WalkStep[] }): string => {
  const step = input.steps[input.snapshot.index]
  const position = `Step ${String(input.snapshot.index + 1)} of ${String(input.steps.length)}`
  if (step === undefined) return position
  if (input.snapshot.phase === 'arrived') return `${position} · Here: "${step.locator?.name ?? ''}"`
  return `${position} · ${ReachModel.describeStep(step)}`
}

const announcement = (input: { readonly snapshot: WalkSnapshot; readonly reach: FeatureReach; readonly steps: readonly WalkStep[] }): string => {
  const step = input.steps[input.snapshot.index]
  if (step === undefined) return ''
  const chip = chipText({ snapshot: input.snapshot, steps: input.steps })
  const target = targetLabel(step)
  if (input.snapshot.phase === 'arrived') return `${chip}. You reached ${input.reach.title}.`
  if (input.snapshot.phase === 'missing') return `${chip}. ${target} is not on screen.`
  if (input.snapshot.phase === 'unsupported') return `${chip}. ${step.unsupported ?? ''}`
  return target === '' ? `${chip}.` : `${chip}, ${target}.`
}

/** The ring around a control: fixed, never hit-testable, never moving the page. */
const Ring = (props: { readonly element: Element }): ReactNode => {
  if (!props.element.isConnected) return null
  const box = props.element.getBoundingClientRect()
  return (
    <div
      aria-hidden
      className="dshx:pointer-events-none dshx:fixed dshx:rounded-md dshx:border-2 dshx:border-primary dshx:shadow-[0_0_0_4px_color-mix(in_oklab,var(--dsw-accent,currentColor)_25%,transparent)] dshx:transition-[top,left,width,height] dshx:motion-reduce:transition-none"
      data-walk-ring=""
      style={{
        top: box.top - RING_GAP,
        left: box.left - RING_GAP,
        width: box.width + RING_GAP * 2,
        height: box.height + RING_GAP * 2,
        zIndex: Math.max(BELOW_MODALS, layerOf(props.element) + 1),
      }}
    />
  )
}

const Walk = (props: ShowMeWhereProps & { readonly controller: WalkController; readonly steps: readonly WalkStep[] }): ReactNode => {
  const { controller, reach, steps } = props
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const step = steps[snapshot.index]
  const ringed = snapshot.target ?? snapshot.lastTarget
  const route = reach.route
  const canOpen = route !== null && Routes.available(route, props.routes)
  const last = snapshot.index >= steps.length - 1
  const showNext = !last && snapshot.phase !== 'unsupported' && snapshot.phase !== 'arrived'
  const firstButton = useRef<HTMLButtonElement>(null)
  useEffect(() => firstButton.current?.focus(), [])
  const view = (props.document ?? document).defaultView
  const box = ringed?.isConnected === true ? ringed.getBoundingClientRect() : null
  const lowerHalf = box !== null && view !== null && box.top + box.height / 2 > view.innerHeight / 2
  const zIndex = Math.max(BELOW_MODALS, ringed?.isConnected === true ? layerOf(ringed) + 1 : 0)

  // On the body, like kit dialogs: a slot's own stacking context would otherwise cap the ring under the app chrome.
  return createPortal(
    <div className="dshx-root" data-onboarding-walk="">
      {ringed === null ? null : <Ring element={ringed} />}
      <section
        aria-label="Show me where"
        className={cn(WALK_CARD, lowerHalf ? 'dshx:top-[max(0.75rem,var(--dshx-safe-top))]' : 'dshx:bottom-[max(0.75rem,var(--dshx-safe-bottom))]')}
        data-walk-card=""
        data-walk-phase={snapshot.phase}
        style={{ zIndex }}
      >
        <p className="dshx:min-w-0 dshx:text-xs dshx:text-muted-foreground dshx:break-words">{reach.title}</p>
        <p className="dshx:min-w-0 dshx:text-sm dshx:font-medium dshx:break-words dshx:whitespace-normal" data-walk-chip="">
          {chipText({ snapshot, steps })}
        </p>
        {snapshot.phase === 'missing' && step !== undefined ? (
          <p className="dshx:text-xs dshx:break-words" role="note">
            {targetLabel(step)} is not on screen. {reach.title} lives in {destinationLabel(reach.destination)}
            {reach.currentSurface === null ? '' : ` (${reach.currentSurface})`}.{' '}
            {canOpen ? 'Open it, or go there yourself and the walk continues.' : 'Go there yourself and the walk continues, or press Next.'}
          </p>
        ) : null}
        {snapshot.phase === 'unsupported' && step !== undefined ? (
          <p className="dshx:text-xs dshx:break-words" role="note">
            {step.unsupported}
          </p>
        ) : null}
        {snapshot.phase === 'arrived' ? <p className="dshx:text-xs">You reached it.</p> : null}
        <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
          {snapshot.phase === 'missing' && canOpen ? (
            <Button onClick={() => Routes.open(route, props.routes)} size="sm" variant="outline">
              Open
            </Button>
          ) : null}
          {snapshot.phase === 'unsupported' ? (
            <Button asChild size="sm" variant="outline">
              <a href={reach.docsUrl} rel="noopener noreferrer" target="_blank">
                <ExternalLinkIcon /> Docs
              </a>
            </Button>
          ) : null}
          {showNext ? (
            <Button onClick={controller.next} ref={firstButton} size="sm">
              Next
            </Button>
          ) : null}
          <Button onClick={controller.end} ref={showNext ? undefined : firstButton} size="sm" variant="ghost">
            End
          </Button>
        </div>
        <p aria-live="polite" className="dshx:sr-only" data-walk-announcement="">
          {announcement({ snapshot, reach, steps })}
        </p>
      </section>
    </div>,
    (props.document ?? document).body,
  )
}

/** The walk's steps did not load: the same card as a walk, with Try again and End (on the body, like the walk). */
export const WalkUnreadable = (props: { readonly onRetry: () => void; readonly onEnd: () => void; readonly document?: Document }): ReactNode =>
  createPortal(
    <section
      aria-label="Show me where"
      className={cn('dshx-root dshx:bottom-[max(0.75rem,var(--dshx-safe-bottom))]', WALK_CARD)}
      data-onboarding-walk=""
      data-walk-card=""
      data-walk-phase="unreadable"
      role="alert"
      style={{ zIndex: WALK_LAYER }}
    >
      <p className="dshx:text-sm">Show me where could not load this feature's steps. Try again, or end the walk and open the feature from Getting started.</p>
      <div className="dshx:flex dshx:justify-end dshx:gap-2">
        <Button onClick={props.onRetry} size="sm">
          Try again
        </Button>
        <Button onClick={props.onEnd} size="sm" variant="ghost">
          End
        </Button>
      </div>
    </section>,
    (props.document ?? document).body,
  )

/** The viewport is phone-width; crossing the breakpoint (a rotation) re-renders and restarts the walk on the other steps. */
const usePhone = (root: Document | undefined): boolean => {
  const view = (root ?? document).defaultView
  const query = useMemo(() => (view === null || typeof view.matchMedia !== 'function' ? null : view.matchMedia(PHONE_QUERY)), [view])
  const subscribe = useCallback(
    (listener: () => void) => {
      query?.addEventListener('change', listener)
      return () => query?.removeEventListener('change', listener)
    },
    [query],
  )
  const read = (): boolean => query?.matches === true
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * Show me where: a non-modal walk over one feature's `reach` steps, or its `reachNarrow` steps on a phone-width
 * viewport. It rings the next control and waits for the user to act; unmounting ends the walk and releases everything
 * it watched.
 */
export const ShowMeWhere = (props: ShowMeWhereProps): ReactNode => {
  const [controller, setController] = useState<WalkController | null>(null)
  const onEnd = useRef(props.onEnd)
  onEnd.current = props.onEnd
  const root = props.document
  const isVisible = props.isVisible
  const missingAfterMs = props.missingAfterMs
  const phone = usePhone(root)
  const steps = ReachModel.stepsFor({ reach: props.reach, phone })
  useEffect(() => {
    // Unmounting ends the walk silently; End, Escape or finishing it tell the owner.
    let unmounting = false
    const walk = createWalk({
      steps,
      document: root ?? document,
      isVisible,
      missingAfterMs,
      onEnd: () => {
        if (!unmounting) onEnd.current()
      },
    })
    setController(walk)
    return () => {
      unmounting = true
      walk.end()
    }
  }, [steps, root, isVisible, missingAfterMs])
  if (controller === null) return null
  return <Walk {...props} controller={controller} steps={steps} />
}
