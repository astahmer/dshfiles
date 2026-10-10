import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, ListOrderedIcon, PencilIcon, SendIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { queueApi } from './api.js'
import { messagePreview } from './message-preview.js'
import { decodeQueuedRows, restoredIndex, type QueueEditor, type QueueEditView, type QueuedRow } from './queue-edit.js'
import { useQueueClientForEditing } from './session-queue-editor.js'
import { queueReorderSettings } from './settings.js'

// Inline instead of client.css so this plugin's sheet stays byte-identical to the shared plugin-ui sheet.
const QUEUE_DOCK_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width:
    'calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
  maxWidth: 'calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))',
  margin: '0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)',
  padding: '0 var(--dsh-composer-dock-inset)',
  flex: 'none',
}

/**
 * The shipped queue dock, with reordering and composer editing added.
 *
 * This occupies the `queue` seat itself, so the composer keeps exactly one queue
 * surface: a second entry with another id renders as its own dock beside the
 * shipped one, which is what produced two stacked queues.
 *
 * Remove and steer mutate through `updateQueue` as the shipped dock does. Edit
 * hands the message — text and attachments — to the main composer through the
 * session's queue editor (`queue-edit.ts`); the row stays in place as an
 * "editing" placeholder until Submit, Cancel or Escape ends the edit.
 * `running` and `queueMutable` come from the live session rather than being
 * pinned, because a dock whose steer button is permanently disabled is worse
 * than no dock.
 *
 * Reorder is the one action `updateQueue` cannot express, so it calls the Host's
 * `queue-order` API, which splices the pending list durably. The agent's
 * `queue_move` tool calls the same method, so a button and an agent can never
 * disagree about what a move did.
 */

interface SessionState {
  readonly running: boolean
  readonly subagent: { readonly address: { readonly mode: string } } | null
}

type Direction = 'up' | 'down'

const attachmentsOf = (content: QueuedRow['content']): string | null => {
  const files = content.filter(block => block.type !== 'text')
  if (files.length === 0) return null
  return `${files.length} attachment${files.length === 1 ? '' : 's'}`
}

const IDLE_EDIT_VIEW: QueueEditView = { record: null, loading: false, notice: null }
const noSubscription = (): (() => void) => () => {}
const idleEditView = (): QueueEditView => IDLE_EDIT_VIEW

const RowAction = (props: {
  readonly label: string
  readonly tooltip: string
  readonly disabled: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="dshx:text-muted-foreground dshx:hover:text-foreground"
        aria-label={props.label}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{props.tooltip}</TooltipContent>
  </Tooltip>
)

/** Injected on top of the seat's standard props, as the shipped entry does. */
export interface QueueDockInjected {
  readonly updateQueue: (itemId: MessageId, action: QueueAction) => Promise<unknown>
  /** Absent when this DSH build exposes no composer input or draft attachments to plugins. */
  readonly queueEditor: QueueEditor | undefined
}

/**
 * Props the dock reads. The seat's standard props — including `useSession`,
 * `useProjection` and `sessionId` — come from the framework's own composed type,
 * and the injected values from this slot's `inject`, so neither is restated here.
 */
export type DockProps = ComposedProps<'conversation.input.dock', string, never, undefined, QueueDockInjected, never, undefined>

export const DraggableQueueDock = (props: DockProps): JSX.Element | null => {
  const inbox = props.useProjection('inbox')
  const queue = useApi(queueApi)
  useQueueClientForEditing(queue)
  const preferences = useSettings(queueReorderSettings)
  const expandByDefault = preferences.value?.expandByDefault ?? true
  const previewLength = preferences.value?.previewLength ?? 200
  const rows = useMemo(() => decodeQueuedRows(inbox), [inbox])
  const rowCount = rows.length

  const running = props.useSession((state: SessionState) => state.running)
  const queueMutable = props.useSession((state: SessionState) => state.subagent === null || state.subagent.address.mode === 'continuable')

  const editor = props.queueEditor
  const edit = useSyncExternalStore(editor?.subscribe ?? noSubscription, editor?.getSnapshot ?? idleEditView)
  const record = edit.record
  const queueEditActive = record !== null || edit.loading
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // Open by default (the `expandByDefault` setting): the list is the point of the
  // dock, and a collapsed dock hides the very rows a user queues to act on.
  const [collapsed, setCollapsed] = useState(!expandByDefault)
  const previousRowCount = useRef(rowCount)
  const listId = useId()

  useEffect(() => {
    // Emptying the queue folds the dock, and a new arrival must unfold it again:
    // otherwise the second queued message appears already collapsed, even though
    // nothing asked for that.
    if (rowCount === 0) setCollapsed(true)
    else if (previousRowCount.current === 0) setCollapsed(!expandByDefault)
    previousRowCount.current = rowCount
  }, [expandByDefault, rowCount])

  const editing = record?.status === 'editing'
  useEffect(() => {
    if (!editing || editor === undefined) return
    // Bubble phase: the composer's own popups claim Escape first and mark it handled.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement
      if (!(active instanceof Element) || active.closest('[data-composer-card]') === null) return
      event.preventDefault()
      void editor.cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editing, editor])

  const queueAction = useMutation({
    mutationFn: (request: { readonly itemId: MessageId; readonly action: QueueAction }) => props.updateQueue(request.itemId, request.action),
  })
  const busy = queueAction.isPending ? (queueAction.variables?.itemId ?? null) : null

  const applyAction = (itemId: MessageId, action: QueueAction): void => queueAction.mutate({ itemId, action })

  const move = async (itemId: MessageId, direction: Direction): Promise<void> => {
    await queue.move({ sessionId: props.sessionId, itemId, direction })
  }

  /** Dragging to a far target takes several single steps, never a jump. */
  const moveTowards = async (sourceId: MessageId, targetIndex: number): Promise<void> => {
    const from = rows.findIndex(row => row.id === sourceId)
    if (from < 0 || targetIndex < 0) return
    const steps = targetIndex > from ? targetIndex - from : from - targetIndex
    const direction: Direction = targetIndex > from ? 'down' : 'up'
    for (let step = 0; step < steps; step += 1) await move(sourceId, direction)
  }

  if (rowCount === 0 && record === null && edit.notice === null) return null

  const interactionActive = queueEditActive || (queueMutable && busy !== null)
  const expanded = !collapsed || interactionActive
  const listCount = rowCount + (record === null ? 0 : 1)
  // The shipped dock shows a lone row without a header, so a single queued
  // message is always visible rather than hidden behind a collapsed panel.
  const listVisible = listCount === 1 || expanded

  const dragEnabled = queueMutable && !queueEditActive && busy === null
  const placeholderIndex = record === null ? -1 : restoredIndex({ rows, before: record.before })
  const placeholderPreview =
    record === null
      ? ''
      : messagePreview(
          record.blocks.map(block => (block.type === 'text' ? block : { type: block.type })),
          previewLength,
        )

  const placeholder =
    record === null ? null : (
      <li
        key="queue-edit-placeholder"
        className="dshx:flex dshx:min-h-8 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-dashed dshx:px-2 dshx:py-0.5"
        data-queue-edit-placeholder=""
      >
        <PencilIcon className="dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground" aria-hidden />
        <span className="dshx:flex-none dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
          {record.status === 'restoring' ? 'Restoring' : record.status === 'submitting' ? 'Saving' : record.status === 'failed' ? 'Not restored' : 'Editing'}
        </span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground" title={placeholderPreview || undefined}>
          {placeholderPreview || attachmentsOf(record.blocks) || '—'}
        </span>
      </li>
    )

  const renderRow = (row: QueuedRow, index: number): JSX.Element => {
    const files = attachmentsOf(row.content)
    const rowId = MessageId(row.id)
    const isBusy = busy === rowId
    const preview = messagePreview(row.content, previewLength)
    return (
      <li
        className={cn(
          'dshx:group/row dshx:flex dshx:min-h-8 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1 dshx:py-0.5 dshx:hover:bg-accent/50',
          dragId === row.id && 'dshx:opacity-50',
          dropIndex === index && dragId !== row.id && 'dshx:bg-accent dshx:shadow-[inset_0_2px_0_var(--color-primary)]',
        )}
        key={row.id}
        onDragOver={event => {
          if (dragId === null || dragId === row.id) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropIndex(index)
        }}
        onDragLeave={() => setDropIndex(current => (current === index ? null : current))}
        onDrop={event => {
          event.preventDefault()
          const sourceId = dragId ?? event.dataTransfer.getData('text/plain')
          setDragId(null)
          setDropIndex(null)
          if (sourceId.length > 0 && sourceId !== row.id) void moveTowards(MessageId(sourceId), index)
        }}
        onDragEnd={() => {
          setDragId(null)
          setDropIndex(null)
        }}
      >
        <span
          className={cn(
            'dshx:grid dshx:h-6 dshx:w-4 dshx:flex-none dshx:place-items-center dshx:rounded-sm dshx:text-muted-foreground/60',
            dragEnabled ? 'dshx:cursor-grab dshx:hover:text-foreground dshx:active:cursor-grabbing' : 'dshx:opacity-40',
          )}
          draggable={dragEnabled}
          aria-hidden
          onDragStart={event => {
            setDragId(row.id)
            event.dataTransfer.setData('text/plain', row.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropIndex(null)
          }}
        >
          <GripVerticalIcon className="dshx:size-3.5" />
        </span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm" title={preview || undefined}>
          {preview || files || '—'}
        </span>
        {queueMutable ? (
          <span className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-0.5 dshx:opacity-60 dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:focus-within:opacity-100">
            <RowAction
              label={`Move queued message ${index + 1} up`}
              tooltip="Move up"
              disabled={queueEditActive || index === 0 || busy !== null}
              onClick={() => void move(rowId, 'up')}
            >
              <ChevronUpIcon />
            </RowAction>
            <RowAction
              label={`Move queued message ${index + 1} down`}
              tooltip="Move down"
              disabled={queueEditActive || index === rowCount - 1 || busy !== null}
              onClick={() => void move(rowId, 'down')}
            >
              <ChevronDownIcon />
            </RowAction>
            <RowAction
              label="Edit queued message"
              tooltip={
                editor === undefined
                  ? 'This DSH version cannot hand queued messages to the composer'
                  : row.editable
                    ? 'Edit in the composer'
                    : 'This message holds content the composer cannot edit'
              }
              disabled={editor === undefined || !row.editable || busy !== null || queueEditActive}
              onClick={() => void editor?.begin(row)}
            >
              <PencilIcon />
            </RowAction>
            <RowAction
              label="Remove queued message"
              tooltip="Remove"
              disabled={busy !== null || queueEditActive || isBusy}
              onClick={() => applyAction(rowId, { kind: 'remove' })}
            >
              <Trash2Icon />
            </RowAction>
            <RowAction
              label="Steer with queued message"
              tooltip="Steer"
              disabled={busy !== null || queueEditActive || !running}
              onClick={() => applyAction(rowId, { kind: 'steer' })}
            >
              <SendIcon />
            </RowAction>
          </span>
        ) : null}
      </li>
    )
  }

  const listItems = rows.map(renderRow)
  if (placeholder !== null) listItems.splice(placeholderIndex, 0, placeholder)

  return (
    <TooltipProvider delayDuration={500}>
      <div className="dshx-root" data-queue-dock="" style={QUEUE_DOCK_STYLE}>
        <div className="dshx:w-full dshx:overflow-hidden dshx:rounded-t-lg dshx:border dshx:border-b-0 dshx:bg-popover dshx:py-0.5 dshx:text-popover-foreground">
          {listCount > 1 ? (
            <button
              type="button"
              className="dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-3 dshx:text-left dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default dshx:disabled:hover:bg-transparent"
              aria-controls={listId}
              aria-expanded={expanded}
              disabled={interactionActive}
              onClick={() => setCollapsed(value => !value)}
            >
              <span className="dshx:grid dshx:place-items-center dshx:text-muted-foreground" aria-hidden>
                <ListOrderedIcon className="dshx:size-3.5" />
              </span>
              <span className="dshx:text-sm dshx:font-medium">{listCount} queued</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">top runs first</span>
              <span className="dshx:ml-auto dshx:grid dshx:place-items-center dshx:text-muted-foreground" aria-hidden>
                {expanded ? <ChevronUpIcon className="dshx:size-3.5" /> : <ChevronDownIcon className="dshx:size-3.5" />}
              </span>
            </button>
          ) : null}
          <ul className="dshx:flex dshx:max-h-60 dshx:flex-col dshx:gap-px dshx:overflow-y-auto dshx:px-1 dshx:pb-0.5" id={listId} hidden={!listVisible}>
            {listVisible ? listItems : null}
          </ul>
          {record !== null && editor !== undefined ? (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-t dshx:px-3 dshx:py-1" role="status" data-queue-edit-bar="">
              <span className="dshx:min-w-0 dshx:flex-1 dshx:text-xs dshx:text-muted-foreground">
                {record.status === 'failed'
                  ? record.error
                  : record.status === 'restoring'
                    ? 'Putting the original back in the queue…'
                    : record.status === 'submitting'
                      ? 'Saving the edited message to its place in the queue…'
                      : (record.error ?? 'Editing a queued message in the composer. Submit puts it back in place; Esc cancels.')}
              </span>
              {record.status === 'failed' ? (
                <>
                  <Button type="button" size="xs" variant="ghost" onClick={() => editor.discard()}>
                    Discard original
                  </Button>
                  <Button type="button" size="xs" onClick={() => void editor.cancel()}>
                    Retry
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" size="xs" variant="ghost" disabled={record.status !== 'editing'} onClick={() => void editor.cancel()}>
                    Cancel
                  </Button>
                  <Button type="button" size="xs" disabled={record.status !== 'editing'} onClick={() => editor.submit()}>
                    Submit
                  </Button>
                </>
              )}
            </div>
          ) : null}
          {edit.notice !== null ? (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-3 dshx:pb-1 dshx:text-xs dshx:text-destructive" role="alert">
              <span className="dshx:min-w-0 dshx:flex-1">{edit.notice}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => editor?.dismissNotice()}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
}
