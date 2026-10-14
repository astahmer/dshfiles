import { NotebookPenIcon } from '@dshfiles/plugin-ui/icons'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { useMemo, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ComposerActionProps } from '@dshfiles/dshx/client'
import {
  DRAFT_STORE_KEY,
  MAX_SENT_PROMPTS,
  defaultDraftTitle,
  draftSaveBlock,
  readStoredDrafts,
  removeDraft,
  saveDraft,
  sentPromptFromNode,
  type DraftSaveBlock,
  type DraftStore,
  type SavedDraft,
  type SentPrompt,
} from './draft-store.js'

const draftBlockMessage = {
  'rich-content': 'Remove reference chips and attachments before saving a text-only draft.',
  'too-long': 'This draft is too long to save.',
  busy: 'Wait for the current composer action to finish.',
  empty: 'Enter text before saving a draft.',
} as const satisfies Record<DraftSaveBlock, string>

const readStore = (): DraftStore => {
  try {
    return readStoredDrafts(window.localStorage)
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
  const sentPrompts = useMemo(
    () =>
      chatOrder
        .flatMap(key => {
          const node = chatNodes.get(key)
          if (node?.kind !== 'user') return []
          const prompt = sentPromptFromNode(node.data)
          return prompt === null ? [] : [prompt]
        })
        .slice(-MAX_SENT_PROMPTS)
        .reverse(),
    [chatNodes, chatOrder],
  )

  const changeOpen = (next: boolean): void => {
    setMessage('')
    setIsOpen(next)
  }

  const captureInsertion = (): void => setInsertionSpan(props.inputActions.captureInsertion())

  const persistStore = (nextStore: DraftStore, serialized: string): boolean => {
    try {
      window.localStorage.setItem(DRAFT_STORE_KEY, serialized)
      setStore(nextStore)
      return true
    } catch {
      setMessage('Browser storage is unavailable or full. Your current composer draft is unchanged.')
      return false
    }
  }

  const saveCurrent = (): void => {
    if (block !== null) {
      setMessage(draftBlockMessage[block])
      return
    }
    const result = saveDraft(store, {
      id: crypto.randomUUID(),
      title: title.trim() || defaultDraftTitle(input.draft),
      text: input.draft,
      now: new Date().toISOString(),
    })
    if (!result.ok) {
      setMessage(
        result.reason === 'too-large'
          ? 'The draft store is full. Remove a saved draft and try again.'
          : result.reason === 'limit'
            ? 'The stash holds 20 drafts. Remove one before saving another.'
            : 'The draft title or contents are invalid.',
      )
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
      window.localStorage.setItem(DRAFT_STORE_KEY, JSON.stringify(nextStore))
      setStore(nextStore)
      setMessage('Saved draft removed.')
    } catch {
      setMessage('Browser storage is unavailable. The saved draft was kept.')
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="dshx-root dshx:text-muted-foreground dshx:hover:text-foreground dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-foreground"
          aria-label="Saved drafts"
          onPointerDownCapture={captureInsertion}
          onKeyDownCapture={event => {
            if (event.key === 'Enter' || event.key === ' ') captureInsertion()
          }}
        >
          <NotebookPenIcon />
          Drafts
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="dshx-root dshx:flex dshx:max-h-(--radix-popover-content-available-height) dshx:w-96 dshx:flex-col dshx:gap-0 dshx:overflow-y-auto dshx:p-0"
        aria-label="Saved prompt drafts"
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-3 dshx:pt-3 dshx:pb-2">
          <h2 className="dshx:text-sm dshx:font-semibold">Saved drafts</h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">Stored in this browser only. Text drafts only; references and files stay in the composer.</p>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-3 dshx:pb-2">
          <Input
            className="dshx:h-7 dshx:text-sm dshx:md:text-sm"
            aria-label="Draft title"
            maxLength={120}
            placeholder={defaultDraftTitle(input.draft)}
            value={title}
            onChange={event => setTitle(event.currentTarget.value)}
          />
          <Button type="button" size="sm" disabled={block !== null} onClick={saveCurrent}>
            Save current
          </Button>
        </div>
        <Command className="dshx:rounded-none dshx:border-t dshx:bg-transparent">
          <CommandInput placeholder="Search drafts and sent prompts" />
          <CommandList className="dshx:max-h-72">
            <CommandEmpty className="dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">No matches.</CommandEmpty>
            <CommandGroup heading="Drafts">
              {store.drafts.length === 0 ? <p className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">No saved drafts yet.</p> : null}
              {store.drafts.map(draft => (
                <CommandItem
                  key={draft.id}
                  value={`draft-${draft.id} ${draft.title} ${draft.text}`}
                  onSelect={() => insertSaved(draft)}
                  className="dshx:group/draft dshx:items-start"
                >
                  <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                    <span className="dshx:truncate dshx:font-medium">{draft.title}</span>
                    <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{previewText(draft.text)}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/draft:opacity-100 dshx:group-data-[selected=true]/draft:opacity-100 dshx:hover:text-destructive dshx:focus-visible:opacity-100"
                    aria-label={`Remove ${draft.title}`}
                    onKeyDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation()
                      deleteSaved(draft.id)
                    }}
                  >
                    Remove
                  </Button>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Sent prompts in this session" aria-label="Sent prompt history">
              {sentPrompts.length === 0 ? (
                <p className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">No sent text prompts are loaded for this session.</p>
              ) : null}
              {sentPrompts.map(prompt => (
                <CommandItem
                  key={prompt.id}
                  value={`sent-${prompt.id} ${prompt.text}`}
                  disabled={input.phase !== 'plain'}
                  onSelect={() => insertSentPrompt(prompt)}
                >
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{previewText(prompt.text)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {message.length > 0 ? (
          <p className="dshx:border-t dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
