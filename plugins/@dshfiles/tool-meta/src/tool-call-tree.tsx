import type { RenderOpts, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallOwnerProps, ToolTreeProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createElement, useEffect, useMemo, useRef, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { warnOnce } from './warn-once.js'

const CHAT_NODE_SLOT = 'conversation.chat.node'
const TOOL_CALL_NODE = 'tool-call'

type RenderToolView = ToolTreeProps['renderSlot']
export type ToolMetaComponent = ComponentType<{ readonly owner: ToolCallOwnerProps }>

/** Every wrapper this module made, so a re-registration is wrapped once and dispose can tell ours apart. */
const wrappers = new Set<unknown>()

/**
 * The native tree dispatches every atomic call, root and PTC children alike, through its own `renderSlot`
 * ('tool.call.toolview', owner). Handing it a `renderSlot` that frames each dispatch with a meta line decorates every
 * tool card, whichever plugin owns it, while the tree keeps its own slot authorization, keys and memoization.
 */
export const wrapToolCallTree = (input: { readonly tree: ComponentType<ToolTreeProps>; readonly Meta: ToolMetaComponent }): ComponentType<ToolTreeProps> => {
  const { tree: Tree, Meta } = input
  const ToolCallTreeWithMeta = (props: ToolTreeProps): ReactElement => {
    const nativeRenderSlot: RenderToolView | undefined = props.renderSlot
    const dispatched = useRef(false)
    const renderSlot = useMemo((): RenderToolView | undefined => {
      if (nativeRenderSlot === undefined) return undefined
      const framed = (key: 'tool.call.toolview', owner: ToolCallOwnerProps, options: RenderOpts): ReactNode => {
        dispatched.current = true
        const isWaitCall = owner.toolName === 'job_output' || owner.toolName === 'background_jobs_wait'
        return (
          <div className="dshx:relative" data-dshfiles-tool-meta-frame="">
            {nativeRenderSlot(key, owner, options)}
            {isWaitCall ? (
              <div className="dshx-root dshx:flex dshx:justify-end dshx:pr-2 dshx:pb-2">
                <Meta owner={owner} />
              </div>
            ) : (
              <span className="dshx-root dshx:pointer-events-none dshx:absolute dshx:top-0 dshx:right-0 dshx:flex dshx:h-7 dshx:items-center dshx:pr-2">
                <Meta owner={owner} />
              </span>
            )}
          </div>
        )
      }
      // SAFETY: the tree declares one child slot, 'tool.call.toolview', so the generic key is always that one and
      // its owner is ToolCallOwnerProps.
      return framed as RenderToolView
    }, [nativeRenderSlot])
    useEffect(() => {
      if (nativeRenderSlot === undefined) warnOnce('the tool-call renderer no longer receives renderSlot; tool timings are hidden')
      else if (!dispatched.current) warnOnce('the tool-call renderer rendered without dispatching tool.call.toolview; tool timings are hidden')
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
export const installToolCallTreeWrapper = (input: { readonly slots: SlotLedger; readonly Meta: ToolMetaComponent }): (() => void) => {
  const originals = new Map<StoredEntry, unknown>()
  const wrap = (): void => {
    const entry = toolCallEntryOf(input.slots)
    if (entry === undefined || wrappers.has(entry.component)) return
    if (entry.component === undefined || entry.component === null) {
      warnOnce('the conversation.chat.node "tool-call" entry holds no component; tool timings are hidden')
      return
    }
    originals.set(entry, entry.component)
    // SAFETY: the ledger erases component types; ui-renderer renders this entry's component with ToolTreeProps,
    // which is the 'tool-call' key's declared prop contract.
    entry.component = wrapToolCallTree({ tree: entry.component as ComponentType<ToolTreeProps>, Meta: input.Meta })
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
