import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { ThreadMentionDrag } from '@dshfiles/thread-sidebar/thread-mention'
import { CornerDownLeftIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'

import { AttachFilesButton, AttachmentTray, threadMentionText, useComposerFiles, useFileDrop } from './composer-attachments.js'
import { BacklogImageEditor } from './image-reference-editor.js'
import type { BacklogImageEditorHandle } from './image-reference-editor.js'
import { InlineCompletion } from './inline-completion.js'
import { MentionMenu, useMentionCompletion, type MentionSuggestion, type MentionThread } from './mention-completion.js'
import { continueMarkdownList } from './list-continuation.js'
import { serializeProjectReferenceDraft } from './project-reference-draft.js'

export type ComposerFiles = ReturnType<typeof useComposerFiles>

/**
 * The text box an item's description and replies write in, with the capture composer's powers: `@` agents, backlog
 * items and threads; images and files picked, pasted or dropped; Markdown kept as Markdown.
 */
export const BacklogTextBox = (props: {
  readonly ariaLabel: string
  readonly placeholder: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly threads: readonly MentionThread[]
  readonly projects?: readonly string[]
  readonly tags?: readonly string[]
  readonly attachments: ComposerFiles
  readonly variant: 'body' | 'reply'
  readonly autoFocus?: boolean
  readonly submitLabel?: string
  readonly submitDisabled?: boolean
  readonly pending?: boolean
  readonly onSubmit?: (text: string) => void
  readonly onCancel?: () => void
  readonly onBlur?: () => void
  readonly onFocus?: () => void
  readonly children?: ReactNode
}): JSX.Element => {
  const [caret, setCaret] = useState(props.value.length)
  const [highlight, setHighlight] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const input = useRef<BacklogImageEditorHandle | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const pendingBlur = useRef(false)
  const threadMentionDrag = useRef(false)
  const droppedIntoBox = useRef(false)
  const completion = useMentionCompletion({
    text: props.value,
    caret,
    threads: props.threads,
    projects: props.projects,
    tags: props.tags,
    files: props.attachments.files,
  })
  const rows = dismissed ? [] : completion.suggestions
  const addFiles = async (files: readonly File[]): Promise<void> => {
    const result = await props.attachments.add(files)
    if (result.added.length === 0) return
    input.current?.insertImageReferences(result.added, result.firstImageNumber)
  }
  const drop = useFileDrop({
    onFiles: files => void addFiles(files),
    onThreadMention: sessionId => {
      const thread = props.threads.find(candidate => candidate.id === sessionId)
      const mention = threadMentionText({ sessionId, title: thread?.title ?? sessionId })
      const text = input.current?.getMarkdownText() ?? props.value
      const range = input.current?.getSelectionRange() ?? { start: text.length, end: text.length }
      const next = `${text.slice(0, range.start)}${mention}${text.slice(range.end)}`
      input.current?.replaceRange(range.start, range.end, mention)
      props.onChange(next)
      const position = range.start + mention.length
      setCaret(position)
      requestAnimationFrame(() => input.current?.setCaret(position))
    },
  })
  const reply = props.variant === 'reply'
  const inputClass = cn(
    'dshx:w-full dshx:overflow-y-auto dshx:whitespace-pre-wrap dshx:break-words dshx:bg-transparent dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground',
    reply
      ? 'dshx:max-h-40 dshx:min-h-10 dshx:text-[13px]'
      : 'dshx:min-h-28 dshx:rounded-lg dshx:border dshx:border-input dshx:p-2.5 dshx:text-[13px] dshx:leading-relaxed',
  )

  useEffect(() => {
    if (props.onBlur === undefined) return
    const savePendingBlur = (): void => {
      if (!pendingBlur.current || threadMentionDrag.current) return
      pendingBlur.current = false
      props.onBlur?.()
    }
    const onDragStart = (event: DragEvent): void => {
      if (!ThreadMentionDrag.has(event.dataTransfer)) return
      threadMentionDrag.current = true
    }
    const onDrop = (event: DragEvent): void => {
      if (!threadMentionDrag.current) return
      const target = event.target
      droppedIntoBox.current = target instanceof Node && root.current?.contains(target) === true
    }
    const onDragEnd = (): void => {
      if (!threadMentionDrag.current) return
      threadMentionDrag.current = false
      if (droppedIntoBox.current) pendingBlur.current = false
      else savePendingBlur()
      droppedIntoBox.current = false
    }
    const onPointerUp = (): void => {
      if (!droppedIntoBox.current) savePendingBlur()
    }
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragend', onDragEnd, true)
    document.addEventListener('pointerup', onPointerUp, true)
    return () => {
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('dragend', onDragEnd, true)
      document.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [props.onBlur])

  useEffect(() => {
    setHighlight(0)
    setNavigated(false)
    setDismissed(false)
  }, [completion.token?.trigger, completion.token?.query, completion.token?.scope])

  const pick = (suggestion: MentionSuggestion): void => {
    if (completion.token === null) return
    const { text: next, caret: position } = InlineCompletion.applyPick({ text: props.value, token: completion.token, insert: suggestion.insert })
    const inserted = next.slice(completion.token.start, next.length - props.value.slice(completion.token.end).length)
    input.current?.replaceRange(completion.token.start, completion.token.end, inserted)
    props.onChange(next)
    setCaret(position)
    setDismissed(true)
    requestAnimationFrame(() => input.current?.setCaret(position))
  }

  const submit = (): void => {
    const text = input.current?.getMarkdownText() ?? props.value
    props.onSubmit?.(serializeProjectReferenceDraft(text, props.projects ?? []))
  }

  const blur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    if (next instanceof HTMLElement && next.draggable) {
      pendingBlur.current = true
      return
    }
    props.onBlur?.()
  }

  return (
    <div
      ref={root}
      {...drop.dragProps}
      onBlur={blur}
      className={cn(
        'dshx:relative dshx:flex dshx:flex-col dshx:gap-2',
        reply && 'dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-2.5 dshx:transition-colors dshx:focus-within:border-input',
        drop.dragging && 'dshx:border-primary/60 dshx:ring-2 dshx:ring-primary/15',
      )}
    >
      <MentionMenu
        suggestions={rows}
        highlight={highlight}
        label={reply ? 'Reply suggestions' : 'Description suggestions'}
        onPick={pick}
        onHover={setHighlight}
      />
      <AttachmentTray files={props.attachments.files} onRemove={props.attachments.remove} />
      <BacklogImageEditor
        ref={input}
        ariaLabel={props.ariaLabel}
        autoFocus={props.autoFocus}
        value={props.value}
        files={props.attachments.files}
        placeholder={props.placeholder}
        placeholderClassName={reply ? '' : 'dshx:p-2.5'}
        className={inputClass}
        onChange={props.onChange}
        onCaretChange={setCaret}
        onPasteFiles={files => void addFiles(files)}
        onFocus={props.onFocus}
        onKeyDown={event => {
          if (rows.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setNavigated(true)
              setHighlight(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length)
              return
            }
            // A reply completes an open mention on Enter too: sending `@rev` half-typed would dispatch nothing.
            if (event.key === 'Tab' || (event.key === 'Enter' && (navigated || reply))) {
              const chosen = rows[highlight]
              if (chosen !== undefined) {
                event.preventDefault()
                pick(chosen)
                return
              }
            }
          }
          if (event.key === 'Escape') {
            if (rows.length > 0) {
              setDismissed(true)
              return
            }
            props.onCancel?.()
            return
          }
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          if (event.shiftKey || (!reply && !event.metaKey && !event.ctrlKey)) {
            const range = input.current?.getSelectionRange() ?? { start: caret, end: caret }
            const continuation = continueMarkdownList({ text: input.current?.getText() ?? props.value, ...range })
            if (continuation !== null) {
              event.preventDefault()
              input.current?.replaceText(continuation.value)
              props.onChange(continuation.value)
              setCaret(continuation.caret)
              requestAnimationFrame(() => input.current?.setCaret(continuation.caret))
              return
            }
            if (event.shiftKey || (!reply && !event.metaKey && !event.ctrlKey)) return
          }
          if (event.shiftKey) return
          event.preventDefault()
          submit()
        }}
      />
      {props.children}
      {reply ? (
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
            <AttachFilesButton onFiles={files => void addFiles(files)} />
            <span>
              <Kbd>↵</Kbd> send
            </span>
          </span>
          <Button type="button" size="xs" disabled={props.submitDisabled === true || props.pending === true} onClick={submit}>
            {props.pending === true ? null : <CornerDownLeftIcon />} {props.submitLabel ?? 'Reply'}
          </Button>
        </div>
      ) : (
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
          <AttachFilesButton onFiles={files => void addFiles(files)} label="Attach an image or file to this item" />
          <span>
            Markdown · <code>@</code> items, threads and agents · <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to save
          </span>
        </div>
      )}
    </div>
  )
}
