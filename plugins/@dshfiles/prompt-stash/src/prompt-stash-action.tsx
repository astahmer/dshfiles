import { BookmarkIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { areRecentPromptsEqual, MAX_RECENT_PROMPTS, type RecentPrompt } from './recent-prompts.js'
import { ChatSource, selectRecentPrompts, type PromptActionProps } from './recent-prompts-source.js'
import { MAX_PROMPTS, MAX_PROMPT_TEXT_LENGTH, type SavedPrompt } from './library.js'
import { usePromptLibrary, type PromptLibraryClient } from './library-client.js'
import { PromptEditorForm, type PromptEditorSubmission } from './prompt-editor-form.js'
import { promptLibraryMachine, type PromptLibraryWorkflowClient } from './prompt-library-machine.js'
import { useDraftAttachmentRetention, type DraftAttachmentKeeper } from './draft-attachment-retention.js'

const PromptStashAction = (props: PromptActionProps & { readonly attachmentKeeper: DraftAttachmentKeeper<PromptActionProps['sessionId']> }): JSX.Element => {
  const input = props.useInput(state => state)
  useDraftAttachmentRetention({ keeper: props.attachmentKeeper, sessionId: props.sessionId, count: input.attachmentIds.length })
  const [activeSource, setActiveSource] = useState<'saved' | 'recent'>('saved')
  const libraryClientRef = useRef<PromptLibraryClient | null>(null)
  const inputActionsRef = useRef(props.inputActions)
  const workflowClient = useMemo<PromptLibraryWorkflowClient>(
    () => ({
      save: async (request, options) => {
        const client = libraryClientRef.current
        return client === null ? { kind: 'unavailable', prompts: [] } : client.save(request, options)
      },
      remove: async (request, options) => {
        const client = libraryClientRef.current
        return client === null ? { kind: 'unavailable', prompts: [] } : client.remove(request, options)
      },
      readLatest: async options => {
        const client = libraryClientRef.current
        return client === null ? { kind: 'unavailable' } : client.readLatest(options)
      },
      createId: () => libraryClientRef.current?.createId() ?? globalThis.crypto.randomUUID(),
      now: () => libraryClientRef.current?.now() ?? Date.now(),
      insertText: (text, span) => inputActionsRef.current.insertText(text, span),
    }),
    [],
  )
  const [snapshot, send] = useMachine(promptLibraryMachine, { input: { client: workflowClient } })
  const isOpen = !snapshot.matches('closed')
  const library = usePromptLibrary({ pollWhileOpen: isOpen })
  useEffect(() => {
    libraryClientRef.current = library
    inputActionsRef.current = props.inputActions
  }, [library, props.inputActions])

  const libraryState = library.state
  const prompts = library.prompts
  const editorTarget = snapshot.context.editorTarget
  const editorInitialValues = snapshot.context.editorInitialValues
  const deleteConfirmation = snapshot.context.deleteConfirmation
  const hasInserted = snapshot.context.hasInserted
  const notice = snapshot.context.notice
  const editorStale =
    libraryState === 'ready' &&
    editorTarget !== null &&
    editorTarget.id !== null &&
    prompts.find(prompt => prompt.id === editorTarget.id)?.revision !== editorTarget.expectedRevision
  const currentPromptSaveDisabled =
    input.phase !== 'plain' ||
    input.attachmentIds.length > 0 ||
    input.occurrences.length > 0 ||
    input.draft.trim().length === 0 ||
    input.draft.length > MAX_PROMPT_TEXT_LENGTH ||
    prompts.length >= MAX_PROMPTS
  const [recentPrompts, setRecentPrompts] = useState<readonly RecentPrompt[]>([])
  const triggerId = useId()

  const openLibrary = (): void => {
    setActiveSource('saved')
    send({ type: 'open', span: props.inputActions.captureInsertion() })
  }

  const closeLibrary = (): void => send({ type: 'close' })

  const beginNewPrompt = (): void => send({ type: 'editor.new' })

  const beginEdit = (prompt: SavedPrompt): void =>
    send({
      type: 'editor.edit',
      target: { id: prompt.id, expectedRevision: prompt.revision },
      initialValues: { title: prompt.title, text: prompt.text },
    })

  const saveEditor = (submission: PromptEditorSubmission): void => send({ type: 'editor.save', submission })

  const saveCurrentPrompt = (): void => send({ type: 'current.save', text: input.draft })

  const requestDelete = (prompt: SavedPrompt): void => send({ type: 'delete.request', confirmation: { id: prompt.id, revision: prompt.revision } })

  const insertPrompt = (prompt: SavedPrompt): void => send({ type: 'saved.insert', prompt: { id: prompt.id, revision: prompt.revision } })

  const insertRecentPrompt = (prompt: { readonly text: string }): void => send({ type: 'recent.insert', text: prompt.text })

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
          <span className="dshx:@max-pane-compact:sr-only dshx:in-data-model-compact:sr-only">Prompts</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="dshx-root dshx:flex dshx:max-h-(--radix-popover-content-available-height) dshx:w-[26rem] dshx:flex-col dshx:overflow-y-auto dshx:p-0"
        aria-labelledby={triggerId}
      >
        {props.useChat === undefined ? null : (
          <ChatSource useChat={props.useChat} selector={selectRecentPrompts} isEqual={areRecentPromptsEqual} onChange={setRecentPrompts} />
        )}
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
            {activeSource === 'saved' && libraryState === 'ready' && editorTarget === null ? (
              <div className="dshx:flex dshx:items-center dshx:gap-2">
                <span className="dshx:text-xs dshx:text-muted-foreground" aria-label={`${prompts.length} of ${MAX_PROMPTS} prompts`}>
                  {prompts.length}/{MAX_PROMPTS}
                </span>
                <Button type="button" size="xs" disabled={currentPromptSaveDisabled} onClick={saveCurrentPrompt}>
                  Save current
                </Button>
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        aria-label="New prompt"
                        disabled={prompts.length >= MAX_PROMPTS}
                        onClick={beginNewPrompt}
                      >
                        <PlusIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>New prompt</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
                      onSelect={() => insertRecentPrompt(prompt)}
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

          <TabsContent forceMount value="saved" className="dshx:mt-0">
            {libraryState === 'loading' ? emptyLine('Loading saved prompts…') : null}
            {libraryState === 'invalid' ? emptyLine('Saved data is unreadable and was left untouched.') : null}
            {libraryState === 'unavailable' ? emptyLine('Browser storage is unavailable. Prompts cannot be saved.') : null}
            {libraryState === 'ready' && editorTarget === null ? (
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
                        onSelect={() => insertPrompt(prompt)}
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
                            onClick={() => requestDelete(prompt)}
                          >
                            {isConfirmingDelete(prompt) ? 'Confirm delete' : 'Delete'}
                          </Button>
                          {isConfirmingDelete(prompt) ? (
                            <Button type="button" variant="ghost" size="xs" onClick={() => send({ type: 'delete.cancel' })}>
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
            {editorTarget !== null ? (
              <PromptEditorForm
                key={editorTarget.id === null ? 'new' : `${editorTarget.id}:${editorTarget.expectedRevision ?? ''}`}
                defaultValues={editorInitialValues ?? { title: '', text: '' }}
                focusText={editorTarget.id === null}
                stale={editorStale}
                isSaving={snapshot.matches('savingEditor')}
                onSubmit={saveEditor}
                onCancel={() => send({ type: 'editor.cancel' })}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

export default PromptStashAction
