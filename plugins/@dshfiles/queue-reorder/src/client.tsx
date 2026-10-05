import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconQueueOutlineRegular,
  IconSendOutlineRegular,
  IconTrashOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { queueApi } from './api.js'
import styles from './queue.module.css'

/**
 * The shipped queue dock, with reordering added.
 *
 * This occupies the `queue` seat itself, so the composer keeps exactly one queue
 * surface: a second entry with another id renders as its own dock beside the
 * shipped one, which is what produced two stacked queues.
 *
 * Everything the shipped dock does is preserved — the same structure, spacing and
 * tokens, the same edit/remove/steer actions still mutating through `updateQueue`,
 * the same collapse behaviour, and the same session-derived gating that decides
 * whether steer is offered at all. `running` and `queueMutable` come from the
 * live session rather than being pinned, because a dock whose steer button is
 * permanently disabled is worse than no dock.
 *
 * Reorder is the one action `updateQueue` cannot express, so it calls the Host's
 * `queue-order` API, which splices the pending list durably. The agent's
 * `queue_move` tool calls the same method, so a button and an agent can never
 * disagree about what a move did.
 */

interface TextBlock {
  readonly type: string
  readonly text?: string
}

interface QueuedMessage {
  readonly id: MessageId
  readonly content: readonly TextBlock[]
}

interface SessionState {
  readonly running: boolean
  readonly subagent: { readonly address: { readonly mode: string } } | null
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** Decode one projection row, or `null` when it is not a queued message. */
const asQueuedMessage = (value: unknown): QueuedMessage | null => {
  const record = asRecord(value)
  if (record === null || typeof record.id !== 'string') return null
  const content = Array.isArray(record.content)
    ? record.content.filter((block): block is TextBlock => asRecord(block) !== null && typeof (block as TextBlock).type === 'string')
    : []
  return { id: MessageId(record.id), content }
}

type Direction = 'up' | 'down'

export type QueueAction = { readonly kind: 'edit'; readonly content: readonly TextBlock[] } | { readonly kind: 'remove' } | { readonly kind: 'steer' }

const textOf = (content: readonly TextBlock[]): string | null => {
  const text = content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
  return text.trim().length === 0 ? null : text
}

const attachmentsOf = (content: readonly TextBlock[]): string | null => {
  const files = content.filter(block => block.type !== 'text')
  if (files.length === 0) return null
  return `${files.length} attachment${files.length === 1 ? '' : 's'}`
}

/** One-line preview, truncated the way the shipped dock truncates. */
const previewOf = (content: readonly TextBlock[]): string => {
  const flat = content
    .filter(block => block.type !== 'image' && block.type !== 'file')
    .map(block => (block.type === 'text' ? (block.text ?? '') : `[${block.type}]`))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const chars = Array.from(flat)
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : flat
}

const PREVIEW_CHARS = 200

/** Injected on top of the seat's standard props, as the shipped entry does. */
export interface QueueDockInjected {
  readonly updateQueue: (itemId: MessageId, action: QueueAction) => Promise<unknown>
}

/**
 * Props the dock reads. The seat's standard props — including `useSession`,
 * `useProjection` and `sessionId` — come from the framework's own composed type,
 * and `updateQueue` from this slot's `inject`, so neither is restated here.
 */
export type DockProps = ComposedProps<'conversation.input.dock', string, never, undefined, QueueDockInjected, never, undefined>

export const DraggableQueueDock = (props: DockProps): JSX.Element | null => {
  const inbox = props.useProjection('inbox')
  const queue = useApi(queueApi)
  const rows = useMemo(
    () =>
      (inbox?.['next-turn'] ?? []).flatMap(row => {
        const message = asQueuedMessage(row)
        return message === null ? [] : [message]
      }),
    [inbox],
  )
  const rowCount = rows.length

  const running = props.useSession((state: SessionState) => state.running)
  const queueMutable = props.useSession((state: SessionState) => state.subagent === null || state.subagent.address.mode === 'continuable')

  const [editing, setEditing] = useState<MessageId | null>(null)
  const [draft, setDraft] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // Open by default: the list is the point of the dock, and a collapsed dock
  // hides the very rows a user queues in order to act on.
  const [collapsed, setCollapsed] = useState(false)
  const previousRowCount = useRef(rowCount)
  const listId = useId()
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // Emptying the queue folds the dock, and a new arrival must unfold it again:
    // otherwise the second queued message appears already collapsed, even though
    // nothing asked for that.
    if (rowCount === 0) setCollapsed(true)
    else if (previousRowCount.current === 0) setCollapsed(false)
    previousRowCount.current = rowCount
    if (editing !== null && (!queueMutable || !rows.some(row => row.id === editing))) setEditing(null)
  }, [editing, queueMutable, rowCount, rows])

  useEffect(() => {
    if (editing === null) return
    const text = textOf(rows.find(row => row.id === editing)?.content ?? []) ?? ''
    setDraft(text)
    const node = editorRef.current
    node?.focus()
    node?.setSelectionRange(node.value.length, node.value.length)
  }, [editing, rows])

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

  const saveEdit = (): void => {
    if (editing === null || draft.trim().length === 0) return
    void queueAction.mutateAsync({ itemId: editing, action: { kind: 'edit', content: [{ type: 'text', text: draft }] } }).then(
      () => setEditing(null),
      () => undefined,
    )
  }

  if (rowCount === 0) return null

  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  // The shipped dock shows a lone row without a header, so a single queued
  // message is always visible rather than hidden behind a collapsed panel.
  const listVisible = rowCount === 1 || expanded

  return (
    <div className={styles.dock} data-queue-dock="">
      <div className={styles.panel}>
        {rowCount > 1 ? (
          <button
            type="button"
            className={styles.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => setCollapsed(value => !value)}
          >
            <span className={styles.lead} aria-hidden>
              <IconQueueOutlineRegular />
            </span>
            <span className={styles.count}>{rowCount} queued</span>
            <span className={styles.hint}>top runs first</span>
            <span className={styles.chevron} aria-hidden>
              {expanded ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
            </span>
          </button>
        ) : null}
        <ul className={styles.list} id={listId} hidden={!listVisible}>
          {listVisible
            ? rows.map((row, index) => {
                const text = textOf(row.content)
                const files = attachmentsOf(row.content)
                const isEditing = editing === row.id
                const isBusy = busy === row.id
                return (
                  <li
                    className={dragId === row.id ? `${styles.row} ${styles.rowDragging}` : dropIndex === index ? `${styles.row} ${styles.rowDrop}` : styles.row}
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
                      className={styles.grip}
                      draggable={queueMutable && editing === null && busy === null}
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
                    />
                    <span className={styles.body}>
                      {isEditing ? (
                        <textarea
                          ref={editorRef}
                          className={styles.editor}
                          value={draft}
                          onChange={event => setDraft(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              saveEdit()
                            }
                            if (event.key === 'Escape') setEditing(null)
                          }}
                        />
                      ) : (
                        <span className={styles.preview}>{previewOf(row.content) || files || '—'}</span>
                      )}
                    </span>
                    {queueMutable ? (
                      <span className={styles.actions}>
                        {isEditing ? (
                          <>
                            <Tooltip portal label="Save" side="bottom" delayMs={500}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label="Save queued message"
                                disabled={busy !== null || draft.trim().length === 0}
                                onClick={saveEdit}
                              >
                                <IconCheckOutlineRegular size={14} />
                              </button>
                            </Tooltip>
                            <Tooltip portal label="Cancel" side="bottom" delayMs={500}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label="Cancel editing"
                                disabled={busy !== null}
                                onClick={() => setEditing(null)}
                              >
                                <IconCloseOutlineRegular />
                              </button>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <Tooltip portal label="Move up" side="bottom" delayMs={500} disabled={index === 0}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label={`Move queued message ${index + 1} up`}
                                disabled={index === 0 || busy !== null}
                                onClick={() => void move(row.id, 'up')}
                              >
                                <IconChevronUpOutlineRegular />
                              </button>
                            </Tooltip>
                            <Tooltip portal label="Move down" side="bottom" delayMs={500} disabled={index === rowCount - 1}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label={`Move queued message ${index + 1} down`}
                                disabled={index === rowCount - 1 || busy !== null}
                                onClick={() => void move(row.id, 'down')}
                              >
                                <IconChevronDownOutlineRegular />
                              </button>
                            </Tooltip>
                            <Tooltip portal label="Edit" side="bottom" delayMs={500} disabled={text === null}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label="Edit queued message"
                                disabled={busy !== null || text === null}
                                onClick={() => setEditing(row.id)}
                              >
                                <IconEditOutlineRegular size={14} />
                              </button>
                            </Tooltip>
                            <Tooltip portal label="Remove" side="bottom" delayMs={500}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label="Remove queued message"
                                disabled={isBusy}
                                onClick={() => applyAction(row.id, { kind: 'remove' })}
                              >
                                <IconTrashOutlineRegular size={14} />
                              </button>
                            </Tooltip>
                            <Tooltip portal label="Steer" side="bottom" delayMs={500} disabled={!running}>
                              <button
                                type="button"
                                className={styles.action}
                                aria-label="Steer with queued message"
                                disabled={busy !== null || !running}
                                onClick={() => applyAction(row.id, { kind: 'steer' })}
                              >
                                <IconSendOutlineRegular />
                              </button>
                            </Tooltip>
                          </>
                        )}
                      </span>
                    ) : null}
                  </li>
                )
              })
            : null}
        </ul>
      </div>
    </div>
  )
}
