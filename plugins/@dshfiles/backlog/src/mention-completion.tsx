import { useApi } from '@dshfiles/dshx/client'
import { ImageIcon, MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { AgentChoice } from './agent-dispatch.js'
import { useAgentDispatch } from './agent-dispatch-context.js'
import { backlogApi } from './api.js'
import { InlineCompletion, type InlineToken } from './inline-completion.js'
import { ItemGlyphs } from './item-glyphs.js'
import { imageReferenceLabels } from './image-attachment-reference.js'
import type { ComposerFile } from './composer-files.js'

/** The thread fields an `@` row needs; the composer's `ComposerThread` satisfies it. */
export interface MentionThread {
  readonly id: string
  readonly title: string
  readonly running: boolean
}

/** One row of the `@`/`#` menu, with what picking it inserts. */
export interface MentionSuggestion {
  readonly key: string
  readonly insert: string
  readonly label: ReactNode
  readonly hint: string
}

const NO_TAGS: readonly string[] = []

export interface MentionCompletion {
  readonly token: InlineToken | null
  readonly suggestions: readonly MentionSuggestion[]
}

/**
 * The one `@` list the backlog's text boxes share: agents, backlog items, threads, and `#tags` where the caller knows
 * them. The capture composer and an item's body and reply boxes therefore complete the same sources in the same order.
 */
export const useMentionCompletion = (props: {
  readonly text: string
  readonly caret: number
  readonly threads: readonly MentionThread[]
  readonly projects?: readonly string[] | undefined
  readonly tags?: readonly string[] | undefined
  readonly files?: readonly ComposerFile[] | undefined
}): MentionCompletion => {
  const api = useApi(backlogApi)
  const dispatch = useAgentDispatch()
  const token = InlineCompletion.tokenAt(props.text, props.caret)
  const [agentChoices, setAgentChoices] = useState<readonly AgentChoice[]>([])
  const [itemSuggestions, setItemSuggestions] = useState<readonly MentionSuggestion[]>([])
  const threads = props.threads
  const tags = props.tags ?? NO_TAGS

  useEffect(() => {
    if (token?.trigger !== '@' || dispatch === null) return
    let live = true
    void dispatch
      .choices()
      .then(choices => {
        if (live) setAgentChoices(choices)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [dispatch, token?.trigger])

  useEffect(() => {
    if (token?.trigger !== '@' || token.scope !== null) {
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
  }, [api, token?.scope, token?.trigger, token?.query])

  const suggestions = useMemo((): readonly MentionSuggestion[] => {
    if (token !== null && token.scope !== null) return []
    if (token === null) return []
    const query = token.query.toLowerCase()
    if (token.trigger === '#') {
      const known = tags.filter(tag => tag.startsWith(query)).slice(0, 6)
      const rows = known.map(tag => ({ key: `#${tag}`, insert: `#${tag} `, label: <span>#{tag}</span>, hint: 'tag' }))
      return query !== '' && !known.includes(query)
        ? [...rows, { key: `#${query}+`, insert: `#${query} `, label: <span>#{query}</span>, hint: 'new tag' }]
        : rows
    }
    const threadsRows = threads
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
    const projectRows = InlineCompletion.projects(token, props.projects ?? []).map(row => ({
      key: `workspace:${row.path}`,
      insert: row.insert,
      label: (
        <>
          <ItemGlyphs.ProjectDot project={row.path} />
          <span className="dshx:truncate">{ItemGlyphs.projectName(row.path)}</span>
        </>
      ),
      hint: 'project reference',
    }))
    const imageRows = imageReferenceLabels(props.files ?? [])
      .filter(label => label.toLowerCase().includes(query))
      .map(label => ({
        key: `image:${label}`,
        insert: `@${label} `,
        label: (
          <>
            <ImageIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
            <span>{label}</span>
          </>
        ),
        hint: 'image attachment',
      }))
    const agentRows = InlineCompletion.agents(token, agentChoices).map(row => {
      const agent = agentChoices.find(choice => choice.handle === row.handle)
      return {
        key: `@${row.handle}`,
        insert: row.insert,
        label: (
          <>
            <span aria-hidden>{agent?.glyph ?? '🤖'}</span>
            <span className="dshx:truncate">{agent?.name ?? row.handle}</span>
          </>
        ),
        hint: `@${row.handle}`,
      }
    })
    return [...imageRows, ...agentRows, ...itemSuggestions, ...threadsRows, ...projectRows]
  }, [token, tags, threads, itemSuggestions, agentChoices, props.projects, props.files])

  return { token, suggestions }
}

/** The suggestion popup: one row per completion, styled the same in every backlog text box. */
export const MentionMenu = (props: {
  readonly suggestions: readonly MentionSuggestion[]
  readonly highlight: number
  readonly label: string
  readonly onPick: (suggestion: MentionSuggestion) => void
  readonly onHover: (index: number) => void
}): JSX.Element | null => {
  if (props.suggestions.length === 0) return null
  return (
    <ul
      role="listbox"
      aria-label={props.label}
      className="dshx:absolute dshx:bottom-full dshx:left-2 dshx:z-30 dshx:mb-1.5 dshx:w-80 dshx:max-w-[calc(100%-1rem)] dshx:max-h-[min(420px,calc(100vh-96px))] dshx:overflow-x-hidden dshx:overflow-y-auto dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-1 dshx:shadow-lg dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-bottom-1"
    >
      {props.suggestions.map((suggestion, index) => (
        <li
          key={suggestion.key}
          role="option"
          aria-selected={index === props.highlight}
          onMouseDown={event => {
            event.preventDefault()
            props.onPick(suggestion)
          }}
          onMouseEnter={() => props.onHover(index)}
          className={cn(
            'dshx:flex dshx:h-8 dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-[13px]',
            index === props.highlight && 'dshx:bg-accent',
          )}
        >
          {suggestion.label}
          <span className="dshx:ml-auto dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{suggestion.hint}</span>
        </li>
      ))}
    </ul>
  )
}
