import type { RenderOpts, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps, ToolTreeProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { warnOnce } from './warn-once.js'

const CHAT_NODE_SLOT = 'conversation.chat.node'
const TOOL_CALL_NODE = 'tool-call'

type RenderToolView = ToolTreeProps['renderSlot']
export type ToolMetaComponent = ComponentType<{ readonly owner: ToolCallOwnerProps }>

/** What the frame renders around each call: the timing line, and what other plugins add under the card. */
export interface ToolCallFrameParts {
  readonly Meta: ToolMetaComponent
  readonly Sections?: ComponentType<{ readonly owner: ToolCallOwnerProps; readonly sessionId: string }> | undefined
}

const FRAME_SELECTOR = '[data-dshfiles-tool-meta-frame]'
/** The attribute that marks the card's own top row; the frame's padding rule reads it. */
export const RESERVED_ROW_ATTRIBUTE = 'data-dshfiles-tool-meta-row'
/** The width of the timing label, published on its frame for the reserved row's padding. */
export const RESERVE_PROPERTY = '--dshfiles-tool-meta-reserve'
/** Set on the timing label while its card has a top row that makes room for it; without it the label stays hidden. */
export const ANCHORED_ATTRIBUTE = 'data-dshfiles-tool-meta-anchored'
/**
 * A card that prints its own duration marks any element inside it with this attribute (test-runs does), and gets no
 * timing label: two durations side by side read as one garbled number.
 */
export const OWN_TIMING_SELECTOR = '[data-tool-card-timing="own"]'
/**
 * The card's top row, in the shapes the native cards render: a disclosure header (its row and any trailing accessory),
 * an expandable header element, or a plain disclosure row. The header precedes the body in document order, so the
 * first match is the card's own unless the card has no header and the match belongs to a nested call's frame.
 */
const HEADER_ROW_SELECTOR = '[data-disclosure-header], [data-expandable], [data-disclosure-row]'
/**
 * Set on the timing label while its card's top row is a native disclosure header, the shared 24 px process row: the
 * label then takes that row's height, so its time sits on the row's centre line instead of 2 px under it (council round
 * 22, item 9). Other headers keep the label's 28 px.
 */
export const DISCLOSURE_ANCHOR_ATTRIBUTE = 'data-dshfiles-tool-meta-disclosure'
/** Set on a frame whose card is one collapsed row; the frame then fits that row instead of the message column. */
export const FIT_ATTRIBUTE = 'data-dshfiles-tool-meta-fit'

/**
 * Whether the frame holds one collapsed row and nothing else (DESIGN.md, layout: a work row is as wide as its content):
 * its card reaches its top row through single children, nothing in it is expanded, and no section or in-flow line
 * follows the card. A card with a body (a diff, a plan, a page, a job) keeps the message column, and so does a card that
 * prints its own duration (a test report) or holds a size container, which takes no width from its content and would
 * collapse in a fitted frame. Reads no layout.
 */
export const isLoneRow = (frame: HTMLElement): boolean => {
  const [card, ...rest] = frame.children
  if (card === undefined || rest.some(child => !child.hasAttribute('data-dshfiles-tool-meta-label'))) return false
  const keepsColumn = `[aria-expanded="true"], ${OWN_TIMING_SELECTOR}, [class*="@container"]`
  if (card.matches(keepsColumn) || card.querySelector(keepsColumn) !== null) return false
  let element: Element | null = card
  while (element !== null && !element.matches(HEADER_ROW_SELECTOR)) {
    if (element.children.length !== 1) return false
    element = element.firstElementChild
  }
  return element !== null
}

/** One observer for every timing label on the page; each label registers the callback that re-reserves its row. */
const labelSizes = (() => {
  const callbacks = new Map<Element, () => void>()
  let observer: ResizeObserver | undefined
  return {
    watch: (label: Element, onResize: () => void): (() => void) => {
      if (typeof ResizeObserver === 'undefined') return () => {}
      observer ??= new ResizeObserver(entries => {
        for (const entry of entries) callbacks.get(entry.target)?.()
      })
      callbacks.set(label, onResize)
      observer.observe(label)
      return () => {
        callbacks.delete(label)
        observer?.unobserve(label)
      }
    },
  }
})()

const headerRowOf = (frame: HTMLElement, label: HTMLElement): HTMLElement | undefined => {
  const ownTiming = frame.querySelector(OWN_TIMING_SELECTOR)
  if (ownTiming !== null && ownTiming.closest(FRAME_SELECTOR) === frame) return undefined
  const found = frame.querySelector<HTMLElement>(HEADER_ROW_SELECTOR)
  if (found === null || found.closest(FRAME_SELECTOR) !== frame) return undefined
  // Only the native card, never a section rendered after the label.
  if ((label.compareDocumentPosition(found) & Node.DOCUMENT_POSITION_PRECEDING) === 0) return undefined
  const header = found.parentElement
  return found.matches('[data-disclosure-row]') && header?.matches('[data-disclosure-header]') === true ? header : found
}

/**
 * Keeps the timing label from covering the card's own top row. The label is an overlay (the native card owns its
 * layout), so the frame publishes the label's width and marks the card's top row, which a padding rule then narrows:
 * the row's summary truncates and its trailing controls move left of the label instead of sliding under it. A hidden
 * label (narrow pane, timing off) reserves nothing. A card with no such row (one that draws its own header, as the
 * HTML page card does) cannot make room, so its label stays hidden instead of sitting on the header's controls.
 * Re-runs when the label resizes and when the card's DOM changes (a running row settling into its card, a disclosure
 * opening).
 */
const useHeaderRowReservation = (frameRef: { readonly current: HTMLElement | null }, labelRef: { readonly current: HTMLElement | null }): void => {
  useLayoutEffect(() => {
    const frame = frameRef.current
    const label = labelRef.current
    if (frame === null || label === null) return undefined
    let marked: HTMLElement | undefined
    let width = 0
    let queued: number | undefined
    // Marking reads no layout, so a card that streams (many mutations) never forces one; only a resize measures.
    const mark = (): void => {
      frame.toggleAttribute(FIT_ATTRIBUTE, isLoneRow(frame))
      const anchor = headerRowOf(frame, label)
      label.toggleAttribute(ANCHORED_ATTRIBUTE, anchor !== undefined)
      label.toggleAttribute(DISCLOSURE_ANCHOR_ATTRIBUTE, anchor?.matches('[data-disclosure-header]') === true)
      const row = width > 0 ? anchor : undefined
      if (row === marked && row?.hasAttribute(RESERVED_ROW_ATTRIBUTE) !== false) return
      marked?.removeAttribute(RESERVED_ROW_ATTRIBUTE)
      row?.setAttribute(RESERVED_ROW_ATTRIBUTE, '')
      marked = row
    }
    const measure = (): void => {
      const next = label.firstElementChild === null ? 0 : Math.ceil(label.getBoundingClientRect().width)
      if (next !== width || frame.style.getPropertyValue(RESERVE_PROPERTY) === '') frame.style.setProperty(RESERVE_PROPERTY, `${next}px`)
      width = next
      mark()
    }
    measure()
    const stopWatching = labelSizes.watch(label, measure)
    const mutations = new MutationObserver(() => {
      queued ??= requestAnimationFrame(() => {
        queued = undefined
        mark()
      })
    })
    mutations.observe(frame, { childList: true, subtree: true })
    return () => {
      stopWatching()
      mutations.disconnect()
      if (queued !== undefined) cancelAnimationFrame(queued)
      marked?.removeAttribute(RESERVED_ROW_ATTRIBUTE)
      label.removeAttribute(ANCHORED_ATTRIBUTE)
      label.removeAttribute(DISCLOSURE_ANCHOR_ATTRIBUTE)
      frame.removeAttribute(FIT_ATTRIBUTE)
    }
  }, [frameRef, labelRef])
}

const ToolCallFrame = (props: { readonly card: ReactNode; readonly meta: ReactNode; readonly inFlow: boolean; readonly sections: ReactNode }): ReactElement => {
  const frameRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  useHeaderRowReservation(frameRef, labelRef)
  return (
    // The frame is a size container: in a narrow pane (a phone, a split) the timing would sit over the card's own
    // status chip, so it gives way below the narrow tier (visual refresh P2). Its marked top row is padded by the
    // label's width plus 8px, so the row's content ends 8px before the label. A lone collapsed row fits its content
    // (capped at chat's prose measure) so the label lands right after it, in its reserved room, at every pane width; a
    // size container cannot take its width from its content, so that frame stops being one, and the label's narrow
    // tier (which asks for this frame by name) no longer applies. The `aria-expanded` guard applies in the same frame a
    // row opens, before the attribute is recomputed.
    <div
      ref={frameRef}
      className="dshx:@container/tool-frame dshx:relative dshx:[&_[data-dshfiles-tool-meta-row]]:pe-[calc(var(--dshfiles-tool-meta-reserve)+0.5rem)]! dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:w-fit dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:max-w-[min(100%,var(--dsh-chat-prose-measure,100%))] dshx:data-[dshfiles-tool-meta-fit]:not-has-[[aria-expanded=true]]:[container-type:normal]"
      data-dshfiles-tool-meta-frame=""
    >
      {props.card}
      {props.inFlow ? (
        <div className="dshx-root dshx:flex dshx:justify-end dshx:pr-2 dshx:pb-2">{props.meta}</div>
      ) : (
        <span
          ref={labelRef}
          data-dshfiles-tool-meta-label=""
          className="dshx-root dshx:pointer-events-none dshx:invisible dshx:absolute dshx:top-0 dshx:right-0 dshx:flex dshx:h-7 dshx:items-center dshx:pr-2 dshx:data-[dshfiles-tool-meta-disclosure]:h-6 dshx:data-[dshfiles-tool-meta-anchored]:visible dshx:@max-pane-narrow/tool-frame:hidden"
        >
          {props.meta}
        </span>
      )}
      {props.sections}
    </div>
  )
}

/** Every wrapper this module made, so a re-registration is wrapped once and dispose can tell ours apart. */
const wrappers = new Set<unknown>()

/**
 * The native tree dispatches every atomic call, root and PTC children alike, through its own `renderSlot`
 * ('tool.call.toolview', owner). Handing it a `renderSlot` that frames each dispatch with a meta line decorates every
 * tool card, whichever plugin owns it, while the tree keeps its own slot authorization, keys and memoization.
 */
const wrapToolCallTree = (input: ToolCallFrameParts & { readonly tree: ComponentType<ToolTreeProps> }): ComponentType<ToolTreeProps> => {
  const { tree: Tree, Meta, Sections } = input
  const ToolCallTreeWithMeta = (props: ToolTreeProps): ReactElement => {
    const nativeRenderSlot: RenderToolView | undefined = props.renderSlot
    const sessionId = props.sessionId
    const dispatched = useRef(false)
    const renderSlot = useMemo((): RenderToolView | undefined => {
      if (nativeRenderSlot === undefined) return undefined
      const framed = (key: 'tool.call.toolview', owner: ToolCallOwnerProps, options: RenderOpts): ReactNode => {
        dispatched.current = true
        const isWaitCall = owner.toolName === 'job_output' || owner.toolName === 'background_jobs_wait'
        return (
          <ToolCallFrame
            card={nativeRenderSlot(key, owner, options)}
            inFlow={isWaitCall}
            meta={<Meta owner={owner} />}
            sections={Sections === undefined ? null : <Sections owner={owner} sessionId={sessionId} />}
          />
        )
      }
      // SAFETY: the tree declares one child slot, 'tool.call.toolview', so the generic key is always that one and
      // its owner is ToolCallOwnerProps.
      return framed as RenderToolView
    }, [nativeRenderSlot, sessionId])
    useEffect(() => {
      if (nativeRenderSlot === undefined) warnOnce('the tool-call renderer no longer receives renderSlot. Tool timings are hidden')
      else if (!dispatched.current) warnOnce('the tool-call renderer rendered without dispatching tool.call.toolview. Tool timings are hidden')
    }, [nativeRenderSlot])
    if (renderSlot === undefined) return createElement(Tree, props)
    return createElement(Tree, { ...props, renderSlot })
  }
  wrappers.add(ToolCallTreeWithMeta)
  return ToolCallTreeWithMeta
}

type SlotLedger = {
  entriesOfSlot(key: typeof CHAT_NODE_SLOT): readonly StoredEntry[]
  subscribe(key: typeof CHAT_NODE_SLOT, listener: () => void): () => void
}

const toolCallEntryOf = (slots: Pick<SlotLedger, 'entriesOfSlot'>): StoredEntry | undefined =>
  slots.entriesOfSlot(CHAT_NODE_SLOT).find(candidate => candidate.options.key === TOOL_CALL_NODE)

/**
 * Swap the winning `conversation.chat.node` 'tool-call' entry's component for a wrapper, again whenever that entry
 * is re-registered (HMR, another plugin taking the key). The ledger entry is the only seat a plugin can reach: a
 * shadowing entry would not hold the tree's 'tool.call.toolview' child declaration, so it could not render the cards.
 * Returns the disposer that puts every original back.
 */
export const installToolCallTreeWrapper = (input: ToolCallFrameParts & { readonly slots: SlotLedger }): (() => void) => {
  const originals = new Map<StoredEntry, unknown>()
  const wrap = (): void => {
    const entry = toolCallEntryOf(input.slots)
    if (entry === undefined || wrappers.has(entry.component)) return
    if (entry.component === undefined || entry.component === null) {
      warnOnce('the conversation.chat.node "tool-call" entry holds no component. Tool timings are hidden')
      return
    }
    originals.set(entry, entry.component)
    // SAFETY: the ledger erases component types; ui-renderer renders this entry's component with ToolTreeProps,
    // which is the 'tool-call' key's declared prop contract.
    entry.component = wrapToolCallTree({
      tree: entry.component as ComponentType<ToolTreeProps>,
      Meta: input.Meta,
      Sections: input.Sections,
    })
  }
  wrap()
  const unsubscribe = input.slots.subscribe(CHAT_NODE_SLOT, wrap)
  return () => {
    unsubscribe()
    for (const [entry, original] of originals) if (wrappers.has(entry.component)) entry.component = original
    originals.clear()
  }
}

/** Whether a tool-call renderer was found and wrapped; the caller warns when it never is. */
export const isToolCallTreeWrapped = (slots: Pick<SlotLedger, 'entriesOfSlot'>): boolean => wrappers.has(toolCallEntryOf(slots)?.component)
