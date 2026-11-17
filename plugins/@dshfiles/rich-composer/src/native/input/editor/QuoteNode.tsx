/** Atomic composer quote node and whole-node removal command. */

import { useRef, useState, useSyncExternalStore } from 'react'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@dshfiles/plugin-ui/components/ui/sheet'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { QuotePreview } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QuoteSummary } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EditorConfig, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode, Spread,
} from 'lexical'
import { createCommand, DecoratorNode } from 'lexical'

/** Localized non-persisted labels applied by the owning input shell. */
export interface QuoteNodeLabels {
  readonly remove: string
  /** Comment copy; present when the owner turns a commented quote into an annotation (COMMENT_QUOTE_COMMAND). */
  readonly comment?: { readonly edit: string; readonly selected: string; readonly placeholder: string; readonly done: string } | undefined
}

const EMPTY_LABELS: QuoteNodeLabels = { remove: '' }

/** JSON form used only by Lexical's editor-state APIs, not browser persistence. */
export type SerializedQuoteNode = Spread<{
  text: string
  summary?: QuoteSummary
}, SerializedLexicalNode>

/** Remove one quote occurrence by its Lexical identity. */
export const REMOVE_QUOTE_COMMAND = createCommand<NodeKey>('REMOVE_QUOTE_COMMAND')

/** Give one quote occurrence a comment: its owner moves it into the draft's annotations, which carry comments. */
export const COMMENT_QUOTE_COMMAND = createCommand<{ readonly key: NodeKey; readonly comment: string }>('COMMENT_QUOTE_COMMAND')

/** The phone shell's width: there the comment opens in a bottom sheet, not a popover. */
const PHONE_QUERY = '(max-width: 639.98px)'
const phoneWidth = {
  subscribe: (listener: () => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
    const media = window.matchMedia(PHONE_QUERY)
    media.addEventListener('change', listener)
    return () => { media.removeEventListener('change', listener) }
  },
  snapshot: (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches,
}

/**
 * dshfiles: a tap or click on a draft quote opens its text with a comment field, the annotation pill's editing
 * flow; Enter or closing with a comment hands it to COMMENT_QUOTE_COMMAND, Escape drops it.
 */
const CommentableQuote = ({ editor, nodeKey, text, copy, children }: {
  readonly editor: LexicalEditor
  readonly nodeKey: NodeKey
  readonly text: string
  readonly copy: NonNullable<QuoteNodeLabels['comment']>
  readonly children: ReactNode
}): ReactNode => {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const latest = useRef('')
  const phone = useSyncExternalStore(phoneWidth.subscribe, phoneWidth.snapshot, () => false)
  const write = (value: string): void => { latest.current = value; setComment(value) }
  const openChange = (next: boolean): void => {
    setOpen(next)
    if (next) return
    const value = latest.current
    write('')
    if (value.trim() !== '') editor.dispatchCommand(COMMENT_QUOTE_COMMAND, { key: nodeKey, comment: value })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    event.stopPropagation()
    if (event.key === 'Escape') write('')
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    openChange(false)
  }
  const body = (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-2" data-quote-comment="">
      <span className="dshx:text-xs dshx:text-muted-foreground">{copy.selected}</span>
      <span className="dshx:line-clamp-4 dshx:text-sm dshx:whitespace-pre-wrap dshx:wrap-anywhere dshx:text-foreground">{text}</span>
      <textarea
        autoFocus
        rows={2}
        className="dshx:box-border dshx:min-h-13 dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
        aria-label={copy.edit}
        placeholder={copy.placeholder}
        value={comment}
        onChange={event => { write(event.currentTarget.value) }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
  if (phone) {
    return (
      <>
        <span className="dshx:cursor-pointer" data-quote-comment-trigger="" onClick={() => { openChange(true) }}>{children}</span>
        <Sheet open={open} onOpenChange={openChange}>
          <SheetContent side="bottom" className="dshx-root dshx:gap-3 dshx:p-4 dshx:pb-[max(1rem,var(--dshx-safe-bottom))]">
            <SheetTitle className="dshx:text-sm">{copy.edit}</SheetTitle>
            <SheetDescription className="dshx:sr-only">{copy.placeholder}</SheetDescription>
            {body}
            {/* A phone has no Enter-to-save habit and tapping outside to commit is invisible: confirm explicitly. */}
            <Button type="button" className="dshx:min-h-11 dshx:self-end" data-quote-comment-done="" onClick={() => { openChange(false) }}>
              {copy.done}
            </Button>
          </SheetContent>
        </Sheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <span className="dshx:cursor-pointer" data-quote-comment-trigger="">{children}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="dshx-root dshx:w-[min(28rem,calc(100vw-2rem))] dshx:p-3">
        {body}
      </PopoverContent>
    </Popover>
  )
}

/** Pure React face of one quote node. */
export function QuoteNodeView({ editor, nodeKey, text, summary, labels }: {
  readonly editor: LexicalEditor
  readonly nodeKey: NodeKey
  readonly text: string
  readonly summary?: QuoteSummary | undefined
  readonly labels: QuoteNodeLabels
}) {
  const preview = (
    <QuotePreview
      text={text}
      summary={summary}
      removal={{
        label: labels.remove,
        onRemove: () => { editor.dispatchCommand(REMOVE_QUOTE_COMMAND, nodeKey) },
      }}
    />
  )
  // A summarized quote (a line comment) already carries its own comment.
  if (labels.comment === undefined || summary !== undefined) return preview
  return <CommentableQuote editor={editor} nodeKey={nodeKey} text={text} copy={labels.comment}>{preview}</CommentableQuote>
}

/** One selected transcript range represented as an atomic inline decorator. */
export class QuoteNode extends DecoratorNode<JSX.Element> {
  __text: string
  __summary: QuoteSummary | undefined
  __labels: QuoteNodeLabels

  /** Lexical node registry type tag. */
  static override getType(): string {
    return 'quote'
  }

  /** @param node - node to clone. @returns a copy carrying the same NodeKey. */
  static override clone(node: QuoteNode): QuoteNode {
    return new QuoteNode(
      node.__text,
      node.__labels,
      node.__summary,
      node.__key,
    )
  }

  /** @param json - serialized editor node. @returns a fresh node with default runtime labels. */
  static override importJSON(json: SerializedQuoteNode): QuoteNode {
    return new QuoteNode(json.text, EMPTY_LABELS, json.summary)
  }

  /**
   * @param text - selected text.
   * @param labels - runtime-only localized labels.
   * @param summary - readable display shown instead of the text.
   * @param key - Lexical clone-path key; absent for fresh nodes.
   */
  constructor(
    text: string,
    labels: QuoteNodeLabels = EMPTY_LABELS,
    summary?: QuoteSummary,
    key?: NodeKey,
  ) {
    super(key)
    this.__text = text
    this.__summary = summary
    this.__labels = labels
  }

  /** Serialize the quote data without its runtime presentation state. */
  override exportJSON(): SerializedQuoteNode {
    return {
      ...super.exportJSON(),
      type: 'quote',
      version: 1,
      text: this.__text,
      ...(this.__summary === undefined ? {} : { summary: this.__summary }),
    }
  }

  /** Mount one non-editable inline host. */
  override createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.setAttribute('data-composer-quote', '')
    element.setAttribute('contenteditable', 'false')
    return element
  }

  /** Updates reuse the existing host element. */
  override updateDOM(): boolean {
    return false
  }

  /** Quotes flow with draft text and wrap at their own text boundary. */
  override isInline(): boolean {
    return true
  }

  /** Arrow movement crosses the quote without entering a NodeSelection. */
  override isKeyboardSelectable(): boolean {
    return false
  }

  /** Clipboard text is the exact model-visible Markdown blockquote. */
  override getTextContent(): string {
    return formatQuoteText(this.__text)
  }

  /** Selected visible quote text. */
  getQuoteText(): string {
    return this.getLatest().__text
  }

  /** Readable display the inserting owner supplied, if any. */
  getQuoteSummary(): QuoteSummary | undefined {
    return this.getLatest().__summary
  }

  /** Update the localized remove label without changing persisted quote data. */
  setLabels(labels: QuoteNodeLabels): void {
    const current = this.getLatest().__labels
    if (current.remove !== labels.remove || current.comment?.edit !== labels.comment?.edit
      || current.comment?.selected !== labels.comment?.selected || current.comment?.placeholder !== labels.comment?.placeholder
      || current.comment?.done !== labels.comment?.done) {
      this.getWritable().__labels = labels
    }
  }

  /** Render the quote body and its independent close control. */
  override decorate(editor: LexicalEditor): JSX.Element {
    return (
      <QuoteNodeView
        editor={editor}
        nodeKey={this.__key}
        text={this.__text}
        summary={this.__summary}
        labels={this.__labels}
      />
    )
  }
}

/**
 * @param text - selected quote text.
 * @param labels - runtime labels.
 * @param summary - readable display shown instead of the text.
 * @returns a fresh node.
 */
export function $createQuoteNode(text: string, labels: QuoteNodeLabels, summary?: QuoteSummary): QuoteNode {
  return new QuoteNode(text, labels, summary)
}

/** @param node - possible Lexical node. @returns whether it is a QuoteNode. */
export function $isQuoteNode(node: LexicalNode | null | undefined): node is QuoteNode {
  return node instanceof QuoteNode
}
