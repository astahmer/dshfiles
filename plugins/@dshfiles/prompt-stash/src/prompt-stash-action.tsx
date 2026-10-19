import { BookmarkIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { useEffect, useId, useRef, useState } from 'react'
import type { ComposerActionProps } from '@dshfiles/dshx/client'
import { areRecentPromptsEqual, MAX_RECENT_PROMPTS, MAX_RECENT_SCAN_NODES, projectRecentPrompts } from './recent-prompts.js'
import { MAX_PROMPTS, MAX_PROMPT_TEXT_LENGTH, MAX_PROMPT_TITLE_LENGTH, PromptLibrary, type SavedPrompt } from './library.js'
import { usePromptLibrary } from './library-client.js'
import { PromptDrafts, type DraftSaveBlock } from './draft-store.js'

const draftBlockNotice = {
  busy: 'Wait for the current composer action to finish.',
  empty: 'Enter text before saving a prompt.',
  'rich-content': 'Saved prompts are text-only. Remove attachments and references first.',
  'too-long': 'The composer text is too long to save as a prompt.',
} as const satisfies Record<DraftSaveBlock, string>

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

const PromptStashAction = (props: ComposerActionProps): JSX.Element => {
  const input = props.useInput(state => state)
  const [isOpen, setIsOpen] = useState(false)
  const library = usePromptLibrary({ pollWhileOpen: isOpen })
  const libraryState = library.state
  const prompts = library.prompts
  const promptSignature = prompts.map(prompt => `${prompt.id}:${prompt.revision}`).join('|')
  const lastPromptSignature = useRef(promptSignature)
  const [activeSource, setActiveSource] = useState<'saved' | 'recent'>('saved')
  const [editor, setEditor] = useState<PromptEditor | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [hasInserted, setHasInserted] = useState(false)
  const [notice, setNotice] = useState('')
  const insertionSpan = useRef<ReturnType<ComposerActionProps['inputActions']['captureInsertion']> | null>(null)
  const promptTextRef = useRef<HTMLTextAreaElement>(null)
  const shouldFocusNewPrompt = useRef(false)
  const currentDraftBlock = PromptDrafts.saveBlock({
    phase: input.phase,
    text: input.draft,
    attachmentCount: input.attachmentIds.length,
    referenceCount: input.occurrences.length,
  })
  const currentPromptSaveDisabled = currentDraftBlock !== null || input.draft.length > MAX_PROMPT_TEXT_LENGTH || prompts.length >= MAX_PROMPTS
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
  const titleId = useId()
  const textId = useId()

  useEffect(() => {
    if (promptSignature === lastPromptSignature.current) return
    lastPromptSignature.current = promptSignature
    setDeleteConfirmation(null)
    setEditor(current => {
      if (current === null || current.id === null) return current
      const saved = prompts.find(prompt => prompt.id === current.id)
      if (saved?.revision === current.originalRevision) return current
      return { ...current, stale: true }
    })
  }, [prompts, promptSignature])

  useEffect(() => {
    if (!shouldFocusNewPrompt.current || editor?.id !== null) return
    shouldFocusNewPrompt.current = false
    promptTextRef.current?.focus()
  }, [editor])

  const openLibrary = (): void => {
    insertionSpan.current = props.inputActions.captureInsertion()
    setActiveSource('saved')
    setHasInserted(false)
    setNotice('')
    setIsOpen(true)
  }

  const beginNewPrompt = (): void => {
    shouldFocusNewPrompt.current = true
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

  const saveEditor = async (saveAsCopy: boolean): Promise<void> => {
    if (editor === null) return
    if (libraryState !== 'ready') return
    const title = editor.title.trim() || PromptLibrary.defaultTitle(editor.text)
    if (editor.text.trim().length === 0) {
      setNotice('Add prompt text before saving.')
      return
    }

    const makeCopy = saveAsCopy || editor.id === null
    if (makeCopy && prompts.length >= MAX_PROMPTS) {
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
    const result = await library.save({ prompt: nextPrompt, expectedRevision: makeCopy ? null : editor.originalRevision })

    if (result.kind === 'conflict') {
      setEditor(current => (current === null ? null : { ...current, stale: true }))
      setNotice('This saved prompt changed in another tab. Your edits remain here; save a copy or reopen it.')
      return
    }
    if (result.kind === 'unavailable') {
      setNotice('The saved library changed or became unavailable. Your editor text is still here.')
      return
    }
    if (result.kind === 'limit') {
      setNotice('This library reached its size limit. Edit or remove a saved prompt first.')
      return
    }

    setEditor(null)
    setNotice('Saved to the prompt library.')
  }

  const saveCurrentPrompt = async (): Promise<void> => {
    if (currentDraftBlock !== null) {
      setNotice(draftBlockNotice[currentDraftBlock])
      return
    }
    if (input.draft.length > MAX_PROMPT_TEXT_LENGTH) {
      setNotice(`Current text exceeds the ${MAX_PROMPT_TEXT_LENGTH.toLocaleString()} character prompt limit.`)
      return
    }
    if (prompts.length >= MAX_PROMPTS) {
      setNotice(`The saved prompt limit is ${MAX_PROMPTS}. Remove a prompt before saving another.`)
      return
    }

    const prompt: SavedPrompt = {
      id: crypto.randomUUID(),
      revision: crypto.randomUUID(),
      title: PromptLibrary.defaultTitle(input.draft),
      text: input.draft,
      updatedAt: Date.now(),
    }
    const result = await library.save({ prompt, expectedRevision: null })
    if (result.kind === 'unavailable') {
      setNotice('The saved library is unavailable. The composer text is unchanged.')
      return
    }
    if (result.kind === 'limit') {
      setNotice(`The saved prompt limit is ${MAX_PROMPTS}. Remove a prompt before saving another.`)
      return
    }
    if (result.kind === 'conflict') {
      setNotice('The prompt library changed in another tab. Try saving again.')
      return
    }

    setNotice('Current composer text saved as a prompt. The composer was not changed.')
  }

  const requestDelete = async (prompt: SavedPrompt): Promise<void> => {
    if (deleteConfirmation === null || deleteConfirmation.id !== prompt.id || deleteConfirmation.revision !== prompt.revision) {
      setDeleteConfirmation({ id: prompt.id, revision: prompt.revision })
      setNotice('Select Confirm delete to remove this saved prompt.')
      return
    }

    const result = await library.remove({ id: prompt.id, expectedRevision: prompt.revision })
    if (result.kind !== 'applied') {
      setDeleteConfirmation(null)
      setNotice(
        result.kind === 'conflict'
          ? 'This prompt changed in another tab. Nothing was deleted.'
          : 'The saved library changed or became unavailable. Nothing was deleted.',
      )
      return
    }

    setDeleteConfirmation(null)
    setNotice('Prompt removed.')
  }

  const insertPrompt = async (prompt: SavedPrompt): Promise<void> => {
    if (hasInserted) return
    const span = insertionSpan.current
    if (span === null) {
      setNotice('Close and reopen the prompt stash to choose a fresh insertion point.')
      return
    }

    const latest = await library.readLatest()
    if (latest.kind !== 'ready') {
      setNotice('The saved library changed or became unavailable. Nothing was inserted.')
      return
    }

    const currentPrompt = latest.prompts.find(item => item.id === prompt.id)
    if (currentPrompt === undefined || currentPrompt.revision !== prompt.revision) {
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

  const isConfirmingDelete = (prompt: SavedPrompt): boolean => deleteConfirmation?.id === prompt.id && deleteConfirmation.revision === prompt.revision

  const emptyLine = (text: string): JSX.Element => <p className="dshx:px-3 dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">{text}</p>

  return (
    <Popover open={isOpen} onOpenChange={next => (next ? openLibrary() : closeLibrary())}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="dshx-root dshx:text-muted-foreground dshx:hover:text-foreground dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-foreground"
          id={triggerId}
          onMouseDown={event => event.preventDefault()}
        >
          <BookmarkIcon />
          <span className="dshx:@max-pane-compact:sr-only">Prompts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="dshx-root dshx:flex dshx:max-h-(--radix-popover-content-available-height) dshx:w-[26rem] dshx:flex-col dshx:overflow-y-auto dshx:p-0"
        aria-labelledby={triggerId}
      >
        <Tabs value={activeSource} onValueChange={value => setActiveSource(value === 'recent' ? 'recent' : 'saved')} className="dshx:gap-0">
          <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3 dshx:px-3 dshx:pt-3">
            <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
              <h2 className="dshx:text-sm dshx:font-semibold">{activeSource === 'recent' ? 'Recent messages' : 'Saved prompts'}</h2>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                {activeSource === 'recent'
                  ? 'Recent text from this conversation only. Attachments are not included.'
                  : 'Saved text is shared through the Host. Files and attachments are not included.'}
              </p>
            </div>
            <Button type="button" variant="ghost" size="xs" onClick={closeLibrary}>
              Done
            </Button>
          </div>
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:px-3">
            <TabsList variant="line" aria-label="Prompt source" className="dshx:h-8 dshx:gap-3 dshx:p-0">
              <TabsTrigger value="saved" className="dshx:flex-none dshx:px-0 dshx:text-xs">
                Saved
              </TabsTrigger>
              <TabsTrigger value="recent" className="dshx:flex-none dshx:px-0 dshx:text-xs">
                Recent here ({Math.min(recentPrompts.length, MAX_RECENT_PROMPTS)})
              </TabsTrigger>
            </TabsList>
            {activeSource === 'saved' && libraryState === 'ready' && editor === null ? (
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <span className="dshx:text-xs dshx:text-muted-foreground" aria-label={`${prompts.length} of ${MAX_PROMPTS} prompts`}>
                  {prompts.length}/{MAX_PROMPTS}
                </span>
                <Button type="button" size="xs" disabled={currentPromptSaveDisabled} onClick={() => void saveCurrentPrompt()}>
                  Save current
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label="New prompt"
                  title="New prompt"
                  disabled={prompts.length >= MAX_PROMPTS}
                  onClick={beginNewPrompt}
                >
                  <PlusIcon />
                </Button>
              </div>
            ) : null}
          </div>

          <p
            className="dshx:px-3 dshx:text-xs dshx:text-muted-foreground dshx:empty:hidden dshx:not-empty:py-2 dshx:not-empty:border-b"
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>

          <TabsContent value="recent" className="dshx:mt-0">
            {recentPrompts.length === 0 ? (
              emptyLine('No sent text prompts are loaded from this conversation.')
            ) : (
              <Command className="dshx:rounded-none dshx:bg-transparent">
                <CommandInput placeholder="Search recent messages" />
                <CommandList className="dshx:max-h-80 dshx:p-1">
                  <CommandEmpty className="dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">No matches.</CommandEmpty>
                  {recentPrompts.map(prompt => (
                    <CommandItem
                      key={prompt.id}
                      value={`${prompt.id} ${prompt.text}`}
                      disabled={hasInserted}
                      onSelect={() => insertRecentPrompt(prompt.id)}
                      className="dshx:flex-col dshx:items-start dshx:gap-0.5"
                    >
                      <span className="dshx:text-xs dshx:text-muted-foreground">Sent message · {new Date(prompt.time).toLocaleString()}</span>
                      <span className="dshx:line-clamp-2 dshx:w-full dshx:text-sm">{prompt.text.slice(0, 180)}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            )}
          </TabsContent>

          <TabsContent value="saved" className="dshx:mt-0">
            {libraryState === 'loading' ? emptyLine('Loading saved prompts…') : null}
            {libraryState === 'invalid' ? emptyLine('Saved data is unreadable and was left untouched.') : null}
            {libraryState === 'unavailable' ? emptyLine('Browser storage is unavailable. Prompts cannot be saved.') : null}
            {libraryState === 'ready' && editor === null ? (
              prompts.length === 0 ? (
                emptyLine('Save a text prompt to reuse it later.')
              ) : (
                <Command className="dshx:rounded-none dshx:bg-transparent">
                  <CommandInput placeholder="Search saved prompts" />
                  <CommandList className="dshx:max-h-80 dshx:p-1">
                    <CommandEmpty className="dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">No matches.</CommandEmpty>
                    {prompts.map(prompt => (
                      <CommandItem
                        key={prompt.id}
                        value={`${prompt.id} ${prompt.title} ${prompt.text}`}
                        onSelect={() => void insertPrompt(prompt)}
                        className="dshx:group/prompt dshx:items-start"
                      >
                        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                          <span className="dshx:truncate dshx:font-medium">{prompt.title}</span>
                          <span className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{prompt.text.slice(0, 180)}</span>
                        </div>
                        <div
                          className={
                            isConfirmingDelete(prompt)
                              ? 'dshx:flex dshx:flex-none dshx:items-center dshx:gap-0.5'
                              : 'dshx:flex dshx:flex-none dshx:items-center dshx:gap-0.5 dshx:opacity-0 dshx:group-hover/prompt:opacity-100 dshx:group-data-[selected=true]/prompt:opacity-100 dshx:focus-within:opacity-100'
                          }
                          onKeyDown={event => event.stopPropagation()}
                          onClick={event => event.stopPropagation()}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="dshx:text-muted-foreground dshx:hover:text-foreground"
                            onClick={() => beginEdit(prompt)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant={isConfirmingDelete(prompt) ? 'destructive' : 'ghost'}
                            size="xs"
                            className={isConfirmingDelete(prompt) ? undefined : 'dshx:text-muted-foreground dshx:hover:text-destructive'}
                            onClick={() => void requestDelete(prompt)}
                          >
                            {isConfirmingDelete(prompt) ? 'Confirm delete' : 'Delete'}
                          </Button>
                          {isConfirmingDelete(prompt) ? (
                            <Button type="button" variant="ghost" size="xs" onClick={() => setDeleteConfirmation(null)}>
                              Keep
                            </Button>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              )
            ) : null}
            {libraryState === 'ready' && editor !== null ? (
              <form
                className="dshx:flex dshx:flex-col dshx:gap-3 dshx:p-3"
                onSubmit={event => {
                  event.preventDefault()
                  void saveEditor(false)
                }}
              >
                <Field orientation="vertical" className="dshx:flex dshx:w-full dshx:flex-col dshx:items-stretch dshx:gap-1.5">
                  <FieldLabel htmlFor={titleId}>Label (optional)</FieldLabel>
                  <Input
                    id={titleId}
                    className="dshx:h-8 dshx:w-full dshx:text-sm dshx:md:text-sm"
                    maxLength={MAX_PROMPT_TITLE_LENGTH}
                    placeholder="Defaults to the first line"
                    value={editor.title}
                    onChange={event => updateEditor('title', event.currentTarget.value)}
                  />
                </Field>
                <Field orientation="vertical" className="dshx:flex dshx:w-full dshx:flex-col dshx:items-stretch dshx:gap-1.5">
                  <FieldLabel htmlFor={textId}>Prompt text</FieldLabel>
                  <Textarea
                    id={textId}
                    ref={promptTextRef}
                    className="dshx:min-h-36 dshx:w-full dshx:text-sm dshx:md:text-sm"
                    maxLength={MAX_PROMPT_TEXT_LENGTH}
                    required
                    rows={8}
                    value={editor.text}
                    onChange={event => updateEditor('text', event.currentTarget.value)}
                  />
                  <FieldDescription className="dshx:w-full dshx:text-right dshx:text-xs">
                    {editor.text.length} of {MAX_PROMPT_TEXT_LENGTH} characters
                  </FieldDescription>
                </Field>
                {editor.stale ? (
                  <p className="dshx:rounded-md dshx:bg-warning/15 dshx:px-2 dshx:py-1.5 dshx:text-xs">
                    The saved version changed elsewhere. Your edits remain here.
                  </p>
                ) : null}
                <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1.5">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditor(null)}>
                    Cancel
                  </Button>
                  {editor.stale ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void saveEditor(true)}>
                      Save as new copy
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" disabled={editor.stale}>
                    Save prompt
                  </Button>
                </div>
              </form>
            ) : null}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

export default PromptStashAction
