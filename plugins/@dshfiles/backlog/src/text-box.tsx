import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { CornerDownLeftIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'

import { AttachFilesButton, AttachmentTray, pasteFiles, useComposerFiles, useFileDrop } from './composer-attachments.js'
import { InlineCompletion } from './inline-completion.js'
import { MentionMenu, useMentionCompletion, type MentionSuggestion, type MentionThread } from './mention-completion.js'
import { continueMarkdownList } from './list-continuation.js'

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
  readonly onSubmit?: () => void
  readonly onCancel?: () => void
  readonly onBlur?: () => void
  readonly onFocus?: () => void
  readonly children?: ReactNode
}): JSX.Element => {
  const [caret, setCaret] = useState(props.value.length)
  const [highlight, setHighlight] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const completion = useMentionCompletion({ text: props.value, caret, threads: props.threads, projects: props.projects, tags: props.tags })
  const rows = dismissed ? [] : completion.suggestions
  const drop = useFileDrop({ onFiles: files => void props.attachments.add(files) })
  const reply = props.variant === 'reply'

  useEffect(() => {
    setHighlight(0)
    setNavigated(false)
    setDismissed(false)
  }, [completion.token?.trigger, completion.token?.query, completion.token?.scope])

  const pick = (suggestion: MentionSuggestion): void => {
    if (completion.token === null) return
    const { text: next, caret: position } = InlineCompletion.applyPick({ text: props.value, token: completion.token, insert: suggestion.insert })
    props.onChange(next)
    setCaret(position)
    setDismissed(true)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
    })
  }

  const submit = (): void => {
    props.onSubmit?.()
  }

  const blur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    props.onBlur?.()
  }

  return (
    <div
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
      <textarea
        ref={input}
        aria-label={props.ariaLabel}
        autoFocus={props.autoFocus}
        rows={reply ? 1 : 3}
        value={props.value}
        placeholder={props.placeholder}
        onPaste={event => pasteFiles(event, files => void props.attachments.add(files))}
        onChange={event => {
          props.onChange(event.currentTarget.value)
          setCaret(event.currentTarget.selectionStart)
        }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
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
            const continuation = continueMarkdownList({
              text: props.value,
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            })
            if (continuation !== null) {
              event.preventDefault()
              props.onChange(continuation.value)
              setCaret(continuation.caret)
              requestAnimationFrame(() => {
                input.current?.setSelectionRange(continuation.caret, continuation.caret)
              })
              return
            }
            if (event.shiftKey || (!reply && !event.metaKey && !event.ctrlKey)) return
          }
          if (event.shiftKey) return
          event.preventDefault()
          submit()
        }}
        className={cn(
          'dshx:field-sizing-content dshx:w-full dshx:resize-none dshx:bg-transparent dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground',
          reply
            ? 'dshx:max-h-40 dshx:min-h-10 dshx:text-[13px]'
            : 'dshx:min-h-28 dshx:rounded-lg dshx:border dshx:border-input dshx:p-2.5 dshx:text-[13px] dshx:leading-relaxed',
        )}
      />
      {props.children}
      {reply ? (
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
            <AttachFilesButton onFiles={files => void props.attachments.add(files)} />
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
          <AttachFilesButton onFiles={files => void props.attachments.add(files)} label="Attach an image or file to this item" />
          <span>
            Markdown · <code>@</code> items, threads and agents · <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to save
          </span>
        </div>
      )}
    </div>
  )
}
