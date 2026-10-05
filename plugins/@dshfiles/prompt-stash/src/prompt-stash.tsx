import { useEffect, useMemo, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ComposerActionProps } from '@dshfiles/dshx/client'
import {
  MAX_SENT_PROMPTS,
  defaultDraftTitle,
  draftSaveBlock,
  readDraftStore,
  removeDraft,
  saveDraft,
  sentPromptFromNode,
  type DraftStore,
  type SavedDraft,
  type SentPrompt,
} from './draft-store.js'
import styles from './prompt-drafts.module.css'

const STORE_KEY = 'dshfiles.prompt-stash.v1'

const readStore = (): DraftStore => {
  try {
    return readDraftStore(window.localStorage.getItem(STORE_KEY))
  } catch {
    return { schemaVersion: 1, drafts: [] }
  }
}

const previewText = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 180)

export const PromptStashAction = (props: ComposerActionProps): JSX.Element => {
  const input = props.useInput(state => state)
  const chatOrder = props.useChat(state => state.order)
  const chatNodes = props.useChat(state => state.nodes)
  const [store, setStore] = useState(readStore)
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [insertionSpan, setInsertionSpan] = useState<ReturnType<ComposerActionProps['inputActions']['captureInsertion']> | null>(null)
  const block = draftSaveBlock({
    phase: input.phase,
    text: input.draft,
    attachmentCount: input.attachmentIds.length,
    referenceCount: input.occurrences.length,
  })
  const sentPrompts = useMemo(() => chatOrder
    .flatMap(key => {
      const node = chatNodes.get(key)
      if (node?.kind !== 'user') return []
      const prompt = sentPromptFromNode(node.data)
      return prompt === null ? [] : [prompt]
    })
    .slice(-MAX_SENT_PROMPTS)
    .reverse(), [chatNodes, chatOrder])

  useEffect(() => {
    if (!isOpen) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isOpen])

  const open = (): void => {
    setMessage('')
    setIsOpen(value => !value)
  }

  const captureInsertion = (): void => setInsertionSpan(props.inputActions.captureInsertion())

  const persistStore = (nextStore: DraftStore, serialized: string): boolean => {
    try {
      window.localStorage.setItem(STORE_KEY, serialized)
      setStore(nextStore)
      return true
    } catch {
      setMessage('Browser storage is unavailable or full. Your current composer draft is unchanged.')
      return false
    }
  }

  const saveCurrent = (): void => {
    if (block !== null) {
      setMessage(block === 'rich-content'
        ? 'Remove reference chips and attachments before saving a text-only draft.'
        : block === 'too-long'
          ? 'This draft is too long to save.'
          : block === 'busy'
            ? 'Wait for the current composer action to finish.'
            : 'Enter text before saving a draft.')
      return
    }
    const result = saveDraft(store, {
      id: crypto.randomUUID(),
      title: title.trim() || defaultDraftTitle(input.draft),
      text: input.draft,
      now: new Date().toISOString(),
    })
    if (!result.ok) {
      setMessage(result.reason === 'too-large'
        ? 'The draft store is full. Remove a saved draft and try again.'
        : result.reason === 'limit'
          ? 'The stash holds 20 drafts. Remove one before saving another.'
          : 'The draft title or contents are invalid.')
      return
    }
    if (persistStore(result.store, result.serialized)) {
      setTitle('')
      setMessage('Saved in this browser. The composer draft remains unchanged.')
    }
  }

  const insertAtSavedPosition = (text: string): void => {
    if (insertionSpan === null || input.phase !== 'plain') {
      setMessage('The composer is busy. Reopen the stash and try again.')
      return
    }
    if (!props.inputActions.insertText(text, insertionSpan)) {
      setMessage('The composer changed while the stash was open. Reopen it to place this draft safely.')
      return
    }
    setMessage('Inserted at the saved composer position. Existing text and attachments were kept.')
  }

  const insertSaved = (draft: SavedDraft): void => insertAtSavedPosition(draft.text)

  const insertSentPrompt = (prompt: SentPrompt): void => insertAtSavedPosition(prompt.text)

  const deleteSaved = (draftId: string): void => {
    const nextStore = removeDraft(store, draftId)
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(nextStore))
      setStore(nextStore)
      setMessage('Saved draft removed.')
    } catch {
      setMessage('Browser storage is unavailable. The saved draft was kept.')
    }
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={isOpen}
        aria-controls="prompt-stash-drafts-panel"
        aria-label="Saved drafts"
        onPointerDownCapture={captureInsertion}
        onKeyDownCapture={event => {
          if (event.key === 'Enter' || event.key === ' ') captureInsertion()
        }}
        onClick={open}
      >
        Drafts
      </button>
      {isOpen ? (
        <section id="prompt-stash-drafts-panel" className={styles.panel} role="dialog" aria-label="Saved prompt drafts">
          <div className={styles.heading}>
            <h2>Saved drafts</h2>
            <button type="button" className={styles.button} onClick={() => setIsOpen(false)} aria-label="Close saved drafts">Close</button>
          </div>
          <p className={styles.note}>Stored in this browser only. Text drafts only; references and files stay in the composer.</p>
          <div className={styles.actions}>
            <input
              className={styles.titleInput}
              aria-label="Draft title"
              maxLength={120}
              placeholder={defaultDraftTitle(input.draft)}
              value={title}
              onChange={event => setTitle(event.currentTarget.value)}
            />
            <button type="button" className={styles.button} disabled={block !== null} onClick={saveCurrent}>Save current</button>
          </div>
          {store.drafts.length === 0 ? <p className={styles.empty}>No saved drafts yet.</p> : (
            <ul className={styles.list}>
              {store.drafts.map(draft => (
                <li className={styles.item} key={draft.id}>
                  <span className={styles.itemTitle}>{draft.title}</span>
                  <span className={styles.preview}>{previewText(draft.text)}</span>
                  <div className={styles.actions}>
                    <button type="button" className={styles.button} disabled={input.phase !== 'plain'} onClick={() => insertSaved(draft)}>Insert</button>
                    <button type="button" className={styles.button} onClick={() => deleteSaved(draft.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <section className={styles.history} aria-label="Sent prompt history">
            <h3>Sent prompts in this session</h3>
            <p className={styles.note}>Text-only user messages from the loaded conversation. File and reference messages stay in the transcript.</p>
            {sentPrompts.length === 0 ? <p className={styles.empty}>No sent text prompts are loaded for this session.</p> : (
              <ul className={styles.list}>
                {sentPrompts.map(prompt => (
                  <li className={styles.item} key={prompt.id}>
                    <span className={styles.preview}>{previewText(prompt.text)}</span>
                    <button type="button" className={styles.button} disabled={input.phase !== 'plain'} onClick={() => insertSentPrompt(prompt)}>Insert</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {message.length > 0 ? <p className={styles.message} role="status">{message}</p> : null}
        </section>
      ) : null}
    </div>
  )
}
