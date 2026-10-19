import { useApi } from '@dshfiles/dshx/client'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { ArrowUpIcon, HashIcon, LinkIcon, MessagesSquareIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { z } from 'zod'

import { backlogApi } from './api.js'
import { BacklogItems, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { useBacklogActions } from './use-backlog-actions.js'

export interface ComposerThread {
  readonly id: string
  readonly title: string
  readonly running: boolean
}

type Suggestion = { readonly key: string; readonly insert: string; readonly label: ReactNode; readonly hint: string }

const draftsSchema = z.record(z.string(), z.string().max(20_000))
const noDrafts: z.infer<typeof draftsSchema> = {}
const drafts = createStoredValue({ key: 'dshfiles.backlog.draft.v1', schema: draftsSchema, fallback: noDrafts })

const chipClass =
  'dshx:inline-flex dshx:h-5 dshx:max-w-56 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:truncate dshx:rounded-full dshx:border dshx:border-border dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground'

/** The `#tag` or `@query` being typed right before the caret, if any. */
const tokenAt = (text: string, caret: number): { readonly trigger: '#' | '@'; readonly query: string; readonly start: number } | null => {
  const match = /(^|\s)([#@])([\w./-]*)$/.exec(text.slice(0, caret))
  if (match === null || match[2] === undefined) return null
  const trigger = match[2] === '#' ? '#' : '@'
  return { trigger, query: match[3] ?? '', start: caret - (match[3] ?? '').length - 1 }
}

/**
 * The capture box: type like a chat message, Enter sends. It never waits on triage: the text clears at once, the item
 * appears from the Host's answer, and a failure puts the text back with a retry. The draft survives reloads.
 */
export const Composer = (props: {
  readonly draftKey: string
  readonly placeholder: string
  readonly tags: readonly string[]
  readonly threads: readonly ComposerThread[]
  readonly status?: BacklogStatus | null
  readonly onClearStatus?: () => void
  readonly inputRef?: RefObject<HTMLTextAreaElement>
  readonly variant: 'chat' | 'compact'
  readonly autoFocus?: boolean
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const storedDrafts = drafts.useValue()
  const [text, setTextState] = useState(() => storedDrafts[props.draftKey] ?? '')
  const [caret, setCaret] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [itemSuggestions, setItemSuggestions] = useState<readonly Suggestion[]>([])
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const input = props.inputRef ?? ownRef

  const setText = (value: string): void => {
    setTextState(value)
    const next = { ...drafts.get() }
    if (value === '') delete next[props.draftKey]
    else next[props.draftKey] = value
    drafts.set(next)
  }

  const token = tokenAt(text, caret)
  useEffect(() => {
    if (token?.trigger !== '@') {
      setItemSuggestions([])
      return
    }
    const controller = new AbortController()
    void api
      .list({ query: token.query, freshness: 'all', limit: 5 }, { signal: controller.signal })
      .then(result =>
        setItemSuggestions(
          result.items.map(item => ({
            key: `b:${String(item.id)}`,
            insert: `b:${String(item.id)} `,
            label: (
              <>
                <ItemGlyphs.StatusIcon status={item.status} />
                <span className="dshx:truncate">{item.title}</span>
              </>
            ),
            hint: `b:${String(item.id)}`,
          })),
        ),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [api, token?.trigger, token?.query])

  const suggestions = useMemo((): readonly Suggestion[] => {
    if (token === null) return []
    const query = token.query.toLowerCase()
    if (token.trigger === '#') {
      const known = props.tags.filter(tag => tag.startsWith(query)).slice(0, 6)
      const rows = known.map(tag => ({ key: `#${tag}`, insert: `#${tag} `, label: <span>#{tag}</span>, hint: 'tag' }))
      return query !== '' && !known.includes(query)
        ? [...rows, { key: `#${query}+`, insert: `#${query} `, label: <span>#{query}</span>, hint: 'new tag' }]
        : rows
    }
    const threads = props.threads
      .filter(thread => thread.title.toLowerCase().includes(query))
      .slice(0, 4)
      .map(thread => ({
        key: thread.id,
        insert: `${thread.id} `,
        label: (
          <>
            <MessagesSquareIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
            <span className="dshx:truncate">{thread.title}</span>
          </>
        ),
        hint: 'thread',
      }))
    return [...itemSuggestions, ...threads]
  }, [token, props.tags, props.threads, itemSuggestions])

  useEffect(() => {
    setHighlight(0)
  }, [token?.trigger, token?.query])

  const pick = (suggestion: Suggestion): void => {
    if (token === null) return
    const next = `${text.slice(0, token.start)}${suggestion.insert}${text.slice(caret)}`
    const position = token.start + suggestion.insert.length
    setText(next)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  const submit = (): void => {
    if (text.trim() === '') return
    setText('')
    setFailed(null)
    props.onClearStatus?.()
    const payload = props.status === null || props.status === undefined ? { text } : { text, status: props.status }
    actions.capture.mutate(payload, {
      onError: error => {
        setFailed(errorMessage(error, 'The item was not saved.'))
        setTextState((current: string) => (current === '' ? text : current))
      },
    })
  }

  const preview = useMemo(() => (text.trim() === '' ? null : BacklogItems.triage(text)), [text])
  const chat = props.variant === 'chat'

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
      className={cn(
        'dshx:relative dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-xl dshx:border dshx:bg-card dshx:transition-[border-color,box-shadow] dshx:focus-within:border-input dshx:focus-within:shadow-sm',
        failed === null ? 'dshx:border-border' : 'dshx:border-destructive/60',
        chat ? 'dshx:px-3 dshx:pt-2.5 dshx:pb-2' : 'dshx:px-2.5 dshx:py-1.5',
      )}
    >
      {suggestions.length === 0 ? null : (
        <ul
          role="listbox"
          aria-label="Suggestions"
          className="dshx:absolute dshx:bottom-full dshx:left-2 dshx:z-30 dshx:mb-1.5 dshx:w-80 dshx:max-w-[calc(100%-1rem)] dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-1 dshx:shadow-lg dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-bottom-1"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.key}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={event => {
                event.preventDefault()
                pick(suggestion)
              }}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                'dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-[13px]',
                index === highlight && 'dshx:bg-accent',
              )}
            >
              {suggestion.label}
              <span className="dshx:ml-auto dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{suggestion.hint}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="dshx:flex dshx:items-end dshx:gap-2">
        <textarea
          ref={input}
          aria-label="Capture"
          rows={1}
          autoFocus={props.autoFocus}
          placeholder={props.placeholder}
          value={text}
          onChange={event => {
            setText(event.currentTarget.value)
            setCaret(event.currentTarget.selectionStart)
          }}
          onSelect={event => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={event => {
            if (suggestions.length > 0) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
                return
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const chosen = suggestions[highlight]
                if (chosen !== undefined) {
                  event.preventDefault()
                  pick(chosen)
                  return
                }
              }
            }
            if (event.key === 'Escape') {
              event.currentTarget.blur()
              return
            }
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          className={cn(
            'dshx:field-sizing-content dshx:min-h-5 dshx:flex-1 dshx:resize-none dshx:bg-transparent dshx:leading-5 dshx:outline-none dshx:placeholder:text-muted-foreground',
            chat ? 'dshx:max-h-60 dshx:py-0.5 dshx:text-sm' : 'dshx:max-h-32 dshx:text-[13px]',
          )}
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={text.trim() === ''}
          className={cn(
            'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:transition-[background-color,opacity,transform] dshx:duration-100 dshx:active:scale-95',
            chat ? 'dshx:size-7' : 'dshx:size-6',
            text.trim() === '' ? 'dshx:bg-muted dshx:text-muted-foreground dshx:opacity-60' : 'dshx:bg-primary dshx:text-primary-foreground',
          )}
        >
          <ArrowUpIcon className="dshx:size-3.5" />
        </button>
      </div>
      {failed !== null ? (
        <p role="alert" className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
          {failed}
          <button type="submit" className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:font-medium dshx:hover:underline">
            <RotateCcwIcon className="dshx:size-3" /> Retry
          </button>
        </p>
      ) : preview === null && (props.status ?? null) === null ? (
        chat ? (
          <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1 dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
            <span>
              <Kbd>↵</Kbd> add · <Kbd>⇧↵</Kbd> new line
            </span>
            <span>
              <code>bug:</code> <code>idea:</code> <code>note:</code> set the kind
            </span>
            <span>
              <HashIcon aria-hidden className="dshx:inline dshx:size-3" /> tags · <code>@</code> items and threads
            </span>
          </p>
        ) : null
      ) : (
        <div aria-label="Capture preview" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:animate-in dshx:fade-in-0">
          {props.status === null || props.status === undefined ? null : (
            <span className={chipClass}>
              <ItemGlyphs.StatusIcon status={props.status} className="dshx:size-3" />
              {ItemGlyphs.statusLabels[props.status]}
              <button type="button" aria-label="Clear status" onClick={props.onClearStatus} className="dshx:hover:text-foreground">
                <XIcon className="dshx:size-3" />
              </button>
            </span>
          )}
          {preview === null ? null : (
            <>
              <span className={chipClass}>
                <ItemGlyphs.KindIcon kind={preview.kind} className="dshx:size-3" />
                {ItemGlyphs.kindLabels[preview.kind]}
              </span>
              {preview.tags.map(tag => (
                <span key={tag} className={chipClass}>
                  #{tag}
                </span>
              ))}
              {preview.links.map(link => (
                <span key={`${link.type}:${link.target}`} className={chipClass}>
                  <LinkIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
                  <span className="dshx:truncate">{link.type === 'item' ? `b:${link.target}` : link.target}</span>
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </form>
  )
}
