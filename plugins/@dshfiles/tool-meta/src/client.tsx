import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ToolCallOwnerProps, ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PendingApproval } from '@deepseek-ai/dsh-client-ui-approval/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, observeSettings, useRegistry, useSettings } from '@dshfiles/dshx/client'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { ApprovalCard } from './approval-card.js'
import { DiffToolCard, type DiffTranslate } from './diff-tool-card.js'
import { TOOL_META_LOCALE_NAMESPACE, toolMetaLocale } from './locales.js'
import { NativeToolView } from './native-tool-view.js'
import { ReadToolCard, type ReadTranslate } from './read-tool-card.js'
import { ToolCallSections, type ToolCallSectionProps } from './tool-call-sections.js'
import { installToolCallTreeWrapper, isToolCallTreeWrapped } from './tool-call-tree.js'
import { toolMetaSettings } from './settings.js'
import { ToolMetaLine } from './tool-meta-line.js'
import { warnOnce } from './warn-once.js'

const ToolCallSectionList = (props: ToolCallSectionProps): JSX.Element | null => {
  const sections = useRegistry(ToolCallSections)
  if (sections.length === 0) return null
  const ordered = sections.toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0))
  return (
    <>
      {ordered.map(({ id, Section }) => (
        <Section key={id} owner={props.owner} sessionId={props.sessionId} />
      ))}
    </>
  )
}

/**
 * The native approval request: it answers through the Host waterfall and can hand the request on (`delegate`). A
 * remote thread's approval (multi-host) shares `kind` but has no waterfall, and keeps its own panel.
 */
const isNativeApproval = (interaction: unknown): interaction is PendingApproval =>
  typeof interaction === 'object' && interaction !== null && 'kind' in interaction && interaction.kind === 'approval' && 'delegate' in interaction

/** Ahead of the native approval panel (priority 1) in the composer chain, so the card renders and the native one waits. */
const APPROVAL_CARD_PRIORITY = 0.5

/**
 * The file tools whose cards this plugin renders itself: `read` on the shared `CodeBlock`, and the file mutations on
 * `PatchView`. Below the native views' default 0, so one of ours renders and the native entry stays reachable as the
 * fallback a card returns to when it has nothing better to show.
 */
const FILE_CARD_TOOLS = ['read', 'edit', 'write', 'apply_patch'] as const
const FILE_CARD_PRIORITY = -10
const REGISTRANT = '@dshfiles/tool-meta'

/** The chat and the tool renderer load beside this plugin; past this they are not coming. */
const WRAP_DEADLINE_MS = 15_000

export default defineClient({
  name: '@dshfiles/tool-meta',
  locales: [toolMetaLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    const t = ctx.locale.bind(TOOL_META_LOCALE_NAMESPACE)
    const TimedLine = decorate(ToolMetaLine)
    const Meta = ({ owner }: { readonly owner: ToolCallOwnerProps }) => <TimedLine owner={owner} t={t} />
    const Sections = decorate(ToolCallSectionList)
    ctx.effect(() => installToolCallTreeWrapper({ slots: ctx.slots, Meta, Sections }), 'tool-meta: wrap the tool-call renderer')
    const settings = observeSettings(ctx, toolMetaSettings)
    const Card = (props: PropsRuntime<'conversation.composer'> & { readonly matched: PendingApproval }) => {
      const display = props.matched.displayReason
      const reason = display === undefined ? (props.matched.reason ?? t('approvalReason', { tool: props.matched.toolName })) : ctx.locale.resolveText(display)
      return <ApprovalCard {...props} reason={reason} t={t} />
    }
    ctx.slots.inject('conversation.composer', () =>
      ctx.slots.register(
        {
          name: 'conversation.composer',
          priority: APPROVAL_CARD_PRIORITY,
          // Read per election, so turning the card off hands the next render back to the native panel.
          select: ({ pendingInteraction }) =>
            settings.getSnapshot()?.approvalCard !== false && isNativeApproval(pendingInteraction) ? pendingInteraction : null,
        },
        decorate(Card),
      ),
    )
    ctx.effect(() => {
      const timer = setTimeout(() => {
        if (!isToolCallTreeWrapped(ctx.slots)) warnOnce('no conversation.chat.node "tool-call" renderer to wrap; tool timings are hidden')
      }, WRAP_DEADLINE_MS)
      return () => clearTimeout(timer)
    }, 'tool-meta: report a missing tool-call renderer')
    const conversation = (key: Parameters<ReadTranslate>[0] | Parameters<DiffTranslate>[0], params?: Record<string, string | number>): string =>
      ctx.locale.bind('conversation')(key, params)
    /** This plugin's own file cards, which the native fallback must never pick. */
    const ownCards = new Set<unknown>()
    /** The native view this plugin shadows, rendered when a card has nothing better to show. */
    const NativeView = ({ toolName, view }: { readonly toolName: string; readonly view: ToolCallViewProps }): ReactNode => {
      const fallback = NativeToolView.pick({ entries: ctx.slots.entries('tool.call.toolview'), toolName, registrant: REGISTRANT, own: ownCards })
      // SAFETY: the ledger erases component types; every entry in a `tool.call.toolview` cell takes ToolCallViewProps.
      const Native = fallback?.component as ComponentType<ToolCallViewProps> | undefined
      return Native === undefined ? null : createElement(Native, view)
    }
    const ReadView = decorate((props: ToolCallViewProps) => {
      const enabled = useSettings(toolMetaSettings).value?.fileCards !== false
      const native = <NativeView toolName="read" view={props} />
      if (!enabled) return native
      return <ReadToolCard call={props} native={native} openFile={props.openFile} t={conversation} useDisclosure={props.useDisclosure} />
    })
    const DiffView = decorate((props: ToolCallViewProps) => {
      const enabled = useSettings(toolMetaSettings).value?.fileCards !== false
      const native = <NativeView toolName={props.toolName} view={props} />
      if (!enabled && props.toolName !== 'apply_patch') return native
      return <DiffToolCard call={props} native={native} t={conversation} useDisclosure={props.useDisclosure} />
    })
    ownCards.add(ReadView).add(DiffView)
    for (const toolName of FILE_CARD_TOOLS) {
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          { name: 'tool.call.toolview', key: toolName, priority: FILE_CARD_PRIORITY, registrant: REGISTRANT, locale: 'conversation' },
          toolName === 'read' ? ReadView : DiffView,
        ),
      )
    }
  },
})
