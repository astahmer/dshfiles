import { useEffect, useId, useRef, useState } from 'react'
import type { ComposerActionProps } from '@dshfiles/dshx/client'
import { areRecentPromptsEqual, MAX_RECENT_PROMPTS, MAX_RECENT_SCAN_NODES, projectRecentPrompts } from './recent-prompts.js'
import {
  MAX_PROMPTS,
  MAX_PROMPT_TEXT_LENGTH,
  MAX_PROMPT_TITLE_LENGTH,
  PROMPT_LIBRARY_STORAGE_KEY,
  readPromptLibrary,
  removePromptIfCurrent,
  serializePromptLibrary,
  writePromptIfCurrent,
  type PromptLibraryRead,
  type SavedPrompt,
} from './library.js'
import styles from './prompt-stash.module.css'

type LibraryState = 'loading' | 'ready' | 'invalid' | 'unavailable'

type PromptEditor = {
  readonly id: string | null
  readonly originalRevision: string | null
  readonly title: string
  readonly text: string
  readonly stale: boolean
}

type DeleteConfirmation = {
  readonly id: string
  readonly revision: string
}

type StorageRead = { readonly kind: 'ready'; readonly prompts: readonly SavedPrompt[] } | { readonly kind: 'invalid' } | { readonly kind: 'unavailable' }

const readLatestPrompts = (): StorageRead => {
  try {
    const result = readPromptLibrary(window.localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY))
    if (!result.ok) return { kind: 'invalid' }
    return { kind: 'ready', prompts: result.prompts }
  } catch {
    return { kind: 'unavailable' }
  }
}

const PromptStashAction = (props: ComposerActionProps): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<'saved' | 'recent'>('saved')
  const [libraryState, setLibraryState] = useState<LibraryState>('loading')
  const [prompts, setPrompts] = useState<readonly SavedPrompt[]>([])
  const [editor, setEditor] = useState<PromptEditor | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [hasInserted, setHasInserted] = useState(false)
  const [notice, setNotice] = useState('')
  const insertionSpan = useRef<ReturnType<ComposerActionProps['inputActions']['captureInsertion']> | null>(null)
  const recentPrompts = props.useChat(chat => {
    const newestFirstNodes = {
      *[Symbol.iterator]() {
        let index = chat.order.length - 1
        let scanned = 0
        while (index >= 0 && scanned < MAX_RECENT_SCAN_NODES) {
          const key = chat.order[index]
          if (key !== undefined) yield chat.nodes.get(key)
          index -= 1
          scanned += 1
        }
      },
    }

    return projectRecentPrompts(newestFirstNodes)
  }, areRecentPromptsEqual)
  const triggerId = useId()
  const regionId = useId()
  const titleId = useId()
  const textId = useId()

  useEffect(() => {
    const initial = readLatestPrompts()
    if (initial.kind === 'ready') {
      setPrompts(initial.prompts)
      setLibraryState('ready')
    } else {
      setLibraryState(initial.kind === 'invalid' ? 'invalid' : 'unavailable')
      setNotice(initial.kind === 'invalid' ? 'Saved prompts could not be read. Stored data was left untouched.' : 'Browser storage is unavailable.')
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== PROMPT_LIBRARY_STORAGE_KEY) return
      const update: PromptLibraryRead = readPromptLibrary(event.newValue)
      if (!update.ok) {
        setLibraryState('invalid')
        setNotice('Saved prompts changed to data this version cannot read. Stored data was left untouched.')
        return
      }

      setPrompts(update.prompts)
      setLibraryState('ready')
      setDeleteConfirmation(null)
      setEditor(current => {
        if (current === null || current.id === null) return current
        const saved = update.prompts.find(prompt => prompt.id === current.id)
        if (saved?.revision === current.originalRevision) return current
        return { ...current, stale: true }
      })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const persist = (next: readonly SavedPrompt[]): boolean => {
    const serialized = serializePromptLibrary(next)
    if (serialized === null) {
      setNotice('This library reached its size limit. Edit or remove a saved prompt first.')
      return false
    }

    try {
      window.localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, serialized)
    } catch {
      setLibraryState('unavailable')
      setNotice('The browser could not save this prompt. The current library is unchanged.')
      return false
    }

    setPrompts(next)
    setLibraryState('ready')
    return true
  }

  const openLibrary = (): void => {
    if (isOpen) {
      insertionSpan.current = null
      setIsOpen(false)
      setEditor(null)
      setDeleteConfirmation(null)
      setNotice('')
      return
    }

    insertionSpan.current = props.inputActions.captureInsertion()
    setActiveSource('saved')
    setHasInserted(false)
    setNotice('')
    setIsOpen(true)
  }

  const beginNewPrompt = (): void => {
    setEditor({ id: null, originalRevision: null, title: '', text: '', stale: false })
    setDeleteConfirmation(null)
    setNotice('')
  }

  const beginEdit = (prompt: SavedPrompt): void => {
    setEditor({
      id: prompt.id,
      originalRevision: prompt.revision,
      title: prompt.title,
      text: prompt.text,
      stale: false,
    })
    setDeleteConfirmation(null)
    setNotice('')
  }

  const saveEditor = (saveAsCopy: boolean): void => {
    if (editor === null) return
    if (libraryState !== 'ready') return
    const title = editor.title.trim()
    if (title.length === 0 || editor.text.trim().length === 0) {
      setNotice('Add a title and prompt text before saving.')
      return
    }

    const latest = readLatestPrompts()
    if (latest.kind !== 'ready') {
      setLibraryState(latest.kind === 'invalid' ? 'invalid' : 'unavailable')
      setNotice('The saved library changed or became unavailable. Your editor text is still here.')
      return
    }

    const makeCopy = saveAsCopy || editor.id === null
    if (makeCopy && latest.prompts.length >= MAX_PROMPTS) {
      setNotice('The saved prompt limit is 50. Remove a prompt before saving another.')
      return
    }

    const nextPrompt: SavedPrompt = {
      id: makeCopy ? crypto.randomUUID() : (editor.id ?? crypto.randomUUID()),
      revision: crypto.randomUUID(),
      title,
      text: editor.text,
      updatedAt: Date.now(),
    }
    const result = writePromptIfCurrent(latest.prompts, nextPrompt, makeCopy ? null : editor.originalRevision)

    if (result.kind === 'conflict') {
      setPrompts(result.prompts)
      setEditor(current => (current === null ? null : { ...current, stale: true }))
      setNotice('This saved prompt changed in another tab. Your edits remain here; save a copy or reopen it.')
      return
    }

    if (!persist(result.prompts)) return
    setEditor(null)
    setNotice('Saved in this browser.')
  }

  const requestDelete = (prompt: SavedPrompt): void => {
    if (deleteConfirmation === null || deleteConfirmation.id !== prompt.id || deleteConfirmation.revision !== prompt.revision) {
      setDeleteConfirmation({ id: prompt.id, revision: prompt.revision })
      setNotice('Select Confirm delete to remove this saved prompt.')
      return
    }

    const latest = readLatestPrompts()
    if (latest.kind !== 'ready') {
      setLibraryState(latest.kind === 'invalid' ? 'invalid' : 'unavailable')
      setNotice('The saved library changed or became unavailable. Nothing was deleted.')
      return
    }

    const result = removePromptIfCurrent(latest.prompts, prompt.id, prompt.revision)
    if (result.kind === 'conflict') {
      setPrompts(result.prompts)
      setDeleteConfirmation(null)
      setNotice('This prompt changed in another tab. Nothing was deleted.')
      return
    }

    if (!persist(result.prompts)) return
    setDeleteConfirmation(null)
    setNotice('Prompt removed.')
  }

  const insertPrompt = (prompt: SavedPrompt): void => {
    if (hasInserted) return
    const span = insertionSpan.current
    if (span === null) {
      setNotice('Close and reopen the prompt stash to choose a fresh insertion point.')
      return
    }

    const latest = readLatestPrompts()
    if (latest.kind !== 'ready') {
      setLibraryState(latest.kind === 'invalid' ? 'invalid' : 'unavailable')
      setNotice('The saved library changed or became unavailable. Nothing was inserted.')
      return
    }

    const currentPrompt = latest.prompts.find(item => item.id === prompt.id)
    if (currentPrompt === undefined || currentPrompt.revision !== prompt.revision) {
      setPrompts(latest.prompts)
      setNotice('This prompt changed in another tab. Choose it again from the refreshed list.')
      return
    }

    if (!props.inputActions.insertText(currentPrompt.text, span)) {
      setNotice('The composer draft changed. Close and reopen the prompt stash before inserting.')
      return
    }

    setHasInserted(true)
    setNotice('Inserted at the saved cursor position. The message was not sent.')
  }

  const insertRecentPrompt = (promptId: string): void => {
    if (hasInserted) return
    const span = insertionSpan.current
    if (span === null) {
      setNotice('Close and reopen the prompt stash to choose a fresh insertion point.')
      return
    }

    const prompt = recentPrompts.find(item => item.id === promptId)
    if (prompt === undefined) {
      setNotice('This message is no longer in the loaded conversation.')
      return
    }

    if (!props.inputActions.insertText(prompt.text, span)) {
      setNotice('The composer draft changed. Close and reopen the prompt stash before inserting.')
      return
    }

    setHasInserted(true)
    setNotice('Inserted at the saved cursor position. The message was not sent.')
  }

  const closeLibrary = (): void => {
    insertionSpan.current = null
    setIsOpen(false)
    setEditor(null)
    setDeleteConfirmation(null)
    setNotice('')
  }

  const updateEditor = (field: 'title' | 'text', value: string): void => {
    setEditor(current => (current === null ? null : { ...current, [field]: value }))
  }

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        id={triggerId}
        aria-controls={regionId}
        aria-expanded={isOpen}
        onMouseDown={event => event.preventDefault()}
        onClick={openLibrary}
      >
        Prompts
      </button>
      {isOpen ? (
        <section
          className={styles.panel}
          id={regionId}
          role="region"
          aria-labelledby={triggerId}
          onKeyDown={event => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            closeLibrary()
          }}
        >
          <div className={styles.header}>
            <div>
              <h2 className={styles.heading}>{activeSource === 'recent' ? 'Recent messages' : 'Saved prompts'}</h2>
              <p className={styles.description}>
                {activeSource === 'recent'
                  ? 'Recent text from this conversation only. Attachments are not included.'
                  : 'Saved text stays in this browser. Files and attachments are not included.'}
              </p>
            </div>
            <button type="button" className={styles.quietButton} onClick={closeLibrary}>
              Done
            </button>
          </div>

          <p className={styles.notice} aria-live="polite">
            {notice}
          </p>

          <div className={styles.listHeader} role="group" aria-label="Prompt source">
            <button
              type="button"
              className={activeSource === 'saved' ? styles.primaryButton : styles.quietButton}
              aria-pressed={activeSource === 'saved'}
              onClick={() => setActiveSource('saved')}
            >
              Saved
            </button>
            <button
              type="button"
              className={activeSource === 'recent' ? styles.primaryButton : styles.quietButton}
              aria-pressed={activeSource === 'recent'}
              onClick={() => setActiveSource('recent')}
            >
              Recent here ({Math.min(recentPrompts.length, MAX_RECENT_PROMPTS)})
            </button>
          </div>

          {activeSource === 'recent' ? (
            <>
              {recentPrompts.length === 0 ? (
                <p className={styles.empty}>No sent text prompts are loaded from this conversation.</p>
              ) : (
                <ul className={styles.list}>
                  {recentPrompts.map(prompt => (
                    <li className={styles.item} key={prompt.id}>
                      <div className={styles.copy}>
                        <h3 className={styles.title}>Sent message · {new Date(prompt.time).toLocaleString()}</h3>
                        <p className={styles.preview}>{prompt.text.slice(0, 180)}</p>
                      </div>
                      <div className={styles.actions}>
                        <button type="button" className={styles.primaryButton} disabled={hasInserted} onClick={() => insertRecentPrompt(prompt.id)}>
                          Insert
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              {libraryState === 'loading' ? <p className={styles.empty}>Loading saved prompts…</p> : null}
              {libraryState === 'invalid' ? <p className={styles.empty}>Saved data is unreadable and was left untouched.</p> : null}
              {libraryState === 'unavailable' ? <p className={styles.empty}>Browser storage is unavailable. Prompts cannot be saved.</p> : null}
              {libraryState === 'ready' ? (
                <>
                  {editor === null ? (
                    <>
                      <div className={styles.listHeader}>
                        <span>
                          {prompts.length} of {MAX_PROMPTS} prompts
                        </span>
                        <button type="button" className={styles.primaryButton} disabled={prompts.length >= MAX_PROMPTS} onClick={beginNewPrompt}>
                          New prompt
                        </button>
                      </div>
                      {prompts.length === 0 ? <p className={styles.empty}>Save a text prompt to reuse it later.</p> : null}
                      <ul className={styles.list}>
                        {prompts.map(prompt => {
                          return (
                            <li className={styles.item} key={prompt.id}>
                              <div className={styles.copy}>
                                <h3 className={styles.title}>{prompt.title}</h3>
                                <p className={styles.preview}>{prompt.text.slice(0, 180)}</p>
                              </div>
                              <div className={styles.actions}>
                                <button type="button" className={styles.primaryButton} disabled={hasInserted} onClick={() => insertPrompt(prompt)}>
                                  Insert
                                </button>
                                <button type="button" className={styles.quietButton} onClick={() => beginEdit(prompt)}>
                                  Edit
                                </button>
                                <button type="button" className={styles.dangerButton} onClick={() => requestDelete(prompt)}>
                                  {deleteConfirmation?.id === prompt.id && deleteConfirmation.revision === prompt.revision ? 'Confirm delete' : 'Delete'}
                                </button>
                                {deleteConfirmation?.id === prompt.id && deleteConfirmation.revision === prompt.revision ? (
                                  <button type="button" className={styles.quietButton} onClick={() => setDeleteConfirmation(null)}>
                                    Keep
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  ) : (
                    <form
                      className={styles.editor}
                      onSubmit={event => {
                        event.preventDefault()
                        saveEditor(false)
                      }}
                    >
                      <label className={styles.field}>
                        <span>Title</span>
                        <input
                          id={titleId}
                          maxLength={MAX_PROMPT_TITLE_LENGTH}
                          required
                          value={editor.title}
                          onChange={event => updateEditor('title', event.currentTarget.value)}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Prompt text</span>
                        <textarea
                          id={textId}
                          maxLength={MAX_PROMPT_TEXT_LENGTH}
                          required
                          rows={8}
                          value={editor.text}
                          onChange={event => updateEditor('text', event.currentTarget.value)}
                        />
                      </label>
                      <p className={styles.counter}>
                        {editor.text.length} of {MAX_PROMPT_TEXT_LENGTH} characters
                      </p>
                      {editor.stale ? <p className={styles.conflict}>The saved version changed elsewhere. Your edits remain here.</p> : null}
                      <div className={styles.actions}>
                        <button type="submit" className={styles.primaryButton} disabled={editor.stale}>
                          Save prompt
                        </button>
                        {editor.stale ? (
                          <button type="button" className={styles.primaryButton} onClick={() => saveEditor(true)}>
                            Save as new copy
                          </button>
                        ) : null}
                        <button type="button" className={styles.quietButton} onClick={() => setEditor(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </>
  )
}

export default PromptStashAction
