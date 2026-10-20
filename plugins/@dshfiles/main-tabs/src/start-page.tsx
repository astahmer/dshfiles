import { ShortcutKeys } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Component, useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { z } from 'zod'
import type { MainTabsTranslate } from './locales.js'

export interface StartSuggestion {
  readonly id: string
  readonly title: string
  readonly description?: string | undefined
  readonly icon: ReactNode
  readonly shortcut: { readonly keys: readonly string[]; readonly aria: string | undefined } | undefined
  readonly pick: () => void
}

type StartColumn = 'threads' | 'panels'

const START_COLUMNS: readonly StartColumn[] = ['threads', 'panels']

export interface StartSection {
  readonly id: string
  readonly column: StartColumn
  readonly label?: string | undefined
  readonly suggestions: readonly StartSuggestion[]
}

interface StartPageProps {
  readonly sections: readonly StartSection[]
  readonly t: MainTabsTranslate
}

/** The compass DSH's own Start page shows (`dsh-client-ui-sidebar-right` GuideTitle), on `currentColor`. */
export const CompassGlyph = (props: { readonly size: number; readonly className?: string }): ReactElement => (
  <svg aria-hidden width={props.size} height={props.size} viewBox="0 0 16 16" fill="none" className={props.className}>
    <path d="M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z" stroke="currentColor" />
    <path d="M10.6101 5.39014L8.99014 8.99014L5.39014 10.6101L7.01014 7.01014L10.6101 5.39014Z" fill="currentColor" />
  </svg>
)

interface PanelIconProps {
  readonly size: number
  readonly active: boolean
}

// The sidebar renders these with its owner props `{ size, active }`; every registered glyph is a plain function component.
const panelIconSchema = z.custom<ComponentType<PanelIconProps>>(value => value instanceof Function)

interface IconBoundaryState {
  readonly failed: boolean
}

class IconBoundary extends Component<{ readonly fallback: ReactNode; readonly children: ReactNode }, IconBoundaryState> {
  override state: IconBoundaryState = { failed: false }
  static getDerivedStateFromError(): IconBoundaryState {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** A panel's own sidebar glyph, or the fallback when it is not a plain component or fails to render outside the sidebar. */
export const PanelIcon = (props: { readonly glyph: unknown; readonly fallback: ReactNode }): ReactElement => {
  const parsed = panelIconSchema.safeParse(props.glyph)
  if (!parsed.success) return <>{props.fallback}</>
  const Glyph = parsed.data
  return (
    <IconBoundary fallback={props.fallback}>
      <Glyph size={22} active={false} />
    </IconBoundary>
  )
}

/**
 * The new-tab page, modelled on DSH's right-panel Start page (`GuideBody`): a muted compass over large rows, each with
 * an icon, a title, an optional description and its shortcut. Arrow keys, Home and End move between rows; Enter picks.
 */
export const StartPage = (props: StartPageProps): ReactElement => {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const sections = props.sections.map(section => ({
    ...section,
    suggestions: section.suggestions.filter(
      suggestion => normalizedQuery.length === 0 || `${suggestion.title} ${suggestion.description ?? ''}`.toLocaleLowerCase().includes(normalizedQuery),
    ),
  }))
  const suggestions = sections.flatMap(section => section.suggestions)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(index => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return Math.max(0, suggestions.length - 1)
        return Math.max(0, Math.min(suggestions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      suggestions[activeIndex]?.pick()
    }
  }

  return (
    <div className="dshx-root dshx:@container dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:bg-background" data-main-tabs-start="">
      <div className="dshx:flex dshx:min-h-full dshx:flex-col dshx:items-center dshx:justify-start dshx:gap-2 dshx:px-6 dshx:py-4 dshx:@max-pane-narrow:px-3 dshx:@max-pane-narrow:py-3">
        <label className="dshx:flex dshx:w-full dshx:max-w-[900px] dshx:items-center dshx:gap-2 dshx:rounded-(--dsw-radius-xl) dshx:border dshx:border-input dshx:bg-card dshx:px-3 dshx:py-2 dshx:shadow-sm">
          <span aria-hidden className="dshx:flex dshx:text-(--dsw-static-neutral-200) dshx:dark:text-(--dsw-static-neutral-700)">
            <CompassGlyph size={20} />
          </span>
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label={props.t('startSearch')}
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls="main-tabs-start-results"
            aria-activedescendant={suggestions[activeIndex] === undefined ? undefined : `start-suggestion-${suggestions[activeIndex].id}`}
            placeholder={props.t('startSearchPlaceholder')}
            value={query}
            className="dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:font-mono! dshx:text-sm dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground"
            onChange={event => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <div
          id="main-tabs-start-results"
          role="listbox"
          aria-label={props.t('startLabel')}
          className="dshx:grid dshx:w-full dshx:max-w-[900px] dshx:grid-cols-2 dshx:items-start dshx:gap-x-6 dshx:gap-y-3 dshx:@max-pane-compact:grid-cols-1"
        >
          {START_COLUMNS.map(column => (
            <div key={column} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3" data-start-column={column}>
              {sections
                .filter(section => section.column === column && section.suggestions.length > 0)
                .map(section => (
                  <div key={section.id} role="group" aria-label={section.label} className="dshx:flex dshx:flex-col dshx:gap-1">
                    {section.label === undefined ? null : (
                      <div aria-hidden className="dshx:px-1 dshx:text-xs dshx:text-(--dsw-alias-label-tertiary)">
                        {section.label}
                      </div>
                    )}
                    {section.suggestions.map(suggestion => {
                      const index = suggestions.indexOf(suggestion)
                      return (
                        <div
                          key={suggestion.id}
                          id={`start-suggestion-${suggestion.id}`}
                          role="option"
                          aria-selected={index === activeIndex}
                          aria-label={suggestion.description === undefined ? suggestion.title : `${suggestion.title}, ${suggestion.description}`}
                          aria-keyshortcuts={suggestion.shortcut?.aria}
                          data-start-suggestion={suggestion.id}
                          className={cn(
                            'dshx:flex dshx:min-h-9 dshx:w-full dshx:cursor-pointer dshx:items-center dshx:gap-2.5 dshx:rounded-(--dsw-radius-xl) dshx:border-[0.5px] dshx:border-input dshx:bg-card dshx:px-3 dshx:py-1 dshx:text-left dshx:text-foreground dshx:outline-none dshx:select-none',
                            'dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                            index === activeIndex && 'dshx:bg-accent',
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={suggestion.pick}
                          onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            suggestion.pick()
                          }}
                        >
                          <span className="dshx:flex dshx:size-[26px] dshx:flex-none dshx:items-center dshx:justify-center dshx:text-muted-foreground">
                            {suggestion.icon}
                          </span>
                          <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-[3px]">
                            <span className="dshx:truncate dshx:text-sm dshx:leading-[1.4]">{suggestion.title}</span>
                            {suggestion.description === undefined ? null : (
                              <span className="dshx:truncate dshx:text-[11px] dshx:leading-[1.4] dshx:text-(--dsw-alias-label-tertiary)">
                                {suggestion.description}
                              </span>
                            )}
                          </span>
                          {suggestion.shortcut === undefined || suggestion.shortcut.keys.length === 0 ? null : <ShortcutKeys keys={suggestion.shortcut.keys} />}
                        </div>
                      )
                    })}
                  </div>
                ))}
            </div>
          ))}
        </div>
        {suggestions.length === 0 ? (
          <p role="status" className="dshx:text-sm dshx:text-muted-foreground">
            {props.t('startNoResults')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
