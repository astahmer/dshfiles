import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useApi } from '@dshfiles/dshx/client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { queueApi } from './api.js'
import styles from './queue.module.css'

/**
 * The shipped queue dock, with reordering added.
 *
 * This replaces the `queue` entry rather than sitting beside it, so the composer
 * keeps one queue surface. It carries the shipped dock's structure, class names
 * and edit/remove/steer actions, which still mutate through `updateQueue`, and
 * adds a drag handle plus ↑/↓ to each row.
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
  readonly id: string
  readonly content: readonly TextBlock[]
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Decode one projection row, or `null` when it is not a queued message. */
const asQueuedMessage = (value: unknown): QueuedMessage | null => {
  const record = asRecord(value)
  if (record === null || typeof record.id !== 'string') return null
  const content = Array.isArray(record.content)
    ? record.content.filter(
        (block): block is TextBlock => asRecord(block) !== null && typeof (block as TextBlock).type === 'string',
      )
    : []
  return { id: record.id, content }
}

/** The `inbox` projection unit shape, narrowed to what the dock reads. */
interface InboxProjection {
  readonly 'next-turn'?: readonly QueuedMessage[]
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

/** Injected on top of the seat's standard props, as the shipped entry does. */
export interface QueueDockInjected {
  readonly updateQueue: (itemId: string, action: QueueAction) => Promise<unknown>
}

/**
 * Props the dock reads. The seat's standard props — including `useProjection`
 * and `sessionId` — come from the framework's own composed type, and
 * `updateQueue` from this slot's `inject`, so neither is restated here.
 */
export type DockProps = ComposedProps<
  'conversation.input.dock',
  string,
  never,
  undefined,
  QueueDockInjected,
  never,
  undefined
>

export const DraggableQueueDock = (props: DockProps): JSX.Element | null => {
  const inbox = props.useProjection('inbox')
  const queue = useApi(queueApi)
  const rows = useMemo(
    () => (inbox?.['next-turn'] ?? []).flatMap(row => {
      const message = asQueuedMessage(row)
      return message === null ? [] : [message]
    }),
    [inbox],
  )
  const rowCount = rows.length

  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [running, setRunning] = useState(false)
  const [mutable] = useState(true)
  const listId = useId()
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (rowCount === 0) setCollapsed(true)
    if (editing !== null && !rows.some(row => row.id === editing)) setEditing(null)
  }, [editing, rowCount, rows])

  useEffect(() => {
    if (editing === null) return
    const text = textOf(rows.find(row => row.id === editing)?.content ?? []) ?? ''
    setDraft(text)
    const node = editorRef.current
    node?.focus()
    node?.setSelectionRange(node.value.length, node.value.length)
  }, [editing, rows])

  const applyAction = async (itemId: string, action: QueueAction): Promise<boolean> => {
    setBusy(itemId)
    try {
      await props.updateQueue(itemId, action)
      return true
    } catch {
      return false
    } finally {
      setBusy(current => (current === itemId ? null : current))
    }
  }

  const move = async (itemId: string, direction: Direction): Promise<void> => {
    await queue.move({ sessionId: props.sessionId, itemId, direction })
  }

  /** Dragging to a far target takes several single steps, never a jump. */
  const moveTowards = async (sourceId: string, targetIndex: number): Promise<void> => {
    const from = rows.findIndex(row => row.id === sourceId)
    if (from < 0 || targetIndex < 0) return
    const steps = targetIndex > from ? targetIndex - from : from - targetIndex
    const direction: Direction = targetIndex > from ? 'down' : 'up'
    for (let step = 0; step < steps; step += 1) await move(sourceId, direction)
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || draft.trim().length === 0) return
    const saved = await applyAction(editing, {
      kind: 'edit',
      content: [{ type: 'text', text: draft }],
    })
    if (saved) setEditing(null)
  }

  if (rowCount === 0) return null

  const interactionActive = mutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive

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
              ⋮
            </span>
            <span className={styles.count}>{rowCount}</span>
            <span className={styles.hint}>queued — drag to reorder, top runs first</span>
          </button>
        ) : null}
        <ul className={styles.list} id={listId} hidden={!expanded}>
          {expanded
            ? rows.map((row, index) => {
                const text = textOf(row.content)
                const files = attachmentsOf(row.content)
                const isEditing = editing === row.id
                const isBusy = busy === row.id
                return (
                  <li
                    className={
                      dropIndex === index ? `${styles.row} ${styles.rowDrop}` : styles.row
                    }
                    key={row.id}
                    onDragOver={event => {
                      if (dragId === null || dragId === row.id) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDropIndex(index)
                    }}
                    onDragLeave={() =>
                      setDropIndex(current => (current === index ? null : current))
                    }
                    onDrop={event => {
                      event.preventDefault()
                      const sourceId = dragId ?? event.dataTransfer.getData('text/plain')
                      setDragId(null)
                      setDropIndex(null)
                      if (sourceId.length > 0 && sourceId !== row.id) void moveTowards(sourceId, index)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setDropIndex(null)
                    }}
                  >
                    <span
                      className={styles.grip}
                      draggable={editing === null && busy === null}
                      aria-hidden
                      title="Drag to reorder"
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
                      ⋮⋮
                    </span>
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
                              void saveEdit()
                            }
                            if (event.key === 'Escape') setEditing(null)
                          }}
                        />
                      ) : (
                        <span className={styles.text}>{text ?? files ?? '—'}</span>
                      )}
                    </span>
                    <span className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        aria-label={`Move queued message ${index + 1} up`}
                        disabled={index === 0 || busy !== null}
                        onClick={() => void move(row.id, 'up')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.action}
                        aria-label={`Move queued message ${index + 1} down`}
                        disabled={index === rowCount - 1 || busy !== null}
                        onClick={() => void move(row.id, 'down')}
                      >
                        ↓
                      </button>
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label="Save queued message"
                            disabled={draft.trim().length === 0}
                            onClick={() => void saveEdit()}
                          >
                            ⏎
                          </button>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label="Cancel editing"
                            onClick={() => setEditing(null)}
                          >
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label="Edit queued message"
                            disabled={busy !== null || text === null}
                            onClick={() => setEditing(row.id)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label="Remove queued message"
                            disabled={isBusy}
                            onClick={() => void applyAction(row.id, { kind: 'remove' })}
                          >
                            🗑
                          </button>
                          <button
                            type="button"
                            className={styles.action}
                            aria-label="Steer with queued message"
                            disabled={!running || isBusy}
                            onClick={() => void applyAction(row.id, { kind: 'steer' })}
                          >
                            ⇧
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                )
              })
            : null}
        </ul>
      </div>
    </div>
  )
}