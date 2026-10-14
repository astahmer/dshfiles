import { ShortcutKeys } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Component, useEffect, useRef, type ComponentType, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
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
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="option"]')?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const options = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const current = options.findIndex(option => option === document.activeElement)
    const next = new Map([
      ['ArrowDown', Math.min(current + 1, options.length - 1)],
      ['ArrowUp', Math.max(current - 1, 0)],
      ['Home', 0],
      ['End', options.length - 1],
    ]).get(event.key)
    if (next === undefined) return
    event.preventDefault()
    options[next]?.focus()
  }

  return (
    <div className="dshx-root dshx:@container dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:bg-background" data-main-tabs-start="">
      <div className="dshx:flex dshx:min-h-full dshx:flex-col dshx:items-center dshx:justify-start dshx:gap-2 dshx:px-6 dshx:py-4 dshx:@max-pane-narrow:px-3 dshx:@max-pane-narrow:py-3">
        <span aria-hidden className="dshx:flex dshx:text-(--dsw-static-neutral-200) dshx:dark:text-(--dsw-static-neutral-700)">
          <CompassGlyph size={40} />
        </span>
        <div
          ref={list}
          role="listbox"
          aria-label={props.t('startLabel')}
          className="dshx:grid dshx:w-full dshx:max-w-[900px] dshx:grid-cols-2 dshx:items-start dshx:gap-x-6 dshx:gap-y-3 dshx:@max-pane-compact:grid-cols-1"
          onKeyDown={onKeyDown}
        >
          {START_COLUMNS.map(column => (
            <div key={column} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3" data-start-column={column}>
              {props.sections
                .filter(section => section.column === column)
                .map(section => (
                  <div key={section.id} role="group" aria-label={section.label} className="dshx:flex dshx:flex-col dshx:gap-1">
                    {section.label === undefined ? null : (
                      <div aria-hidden className="dshx:px-1 dshx:text-xs dshx:text-(--dsw-alias-label-tertiary)">
                        {section.label}
                      </div>
                    )}
                    {section.suggestions.map(suggestion => (
                      <div
                        key={suggestion.id}
                        role="option"
                        aria-selected={false}
                        aria-label={suggestion.description === undefined ? suggestion.title : `${suggestion.title}, ${suggestion.description}`}
                        aria-keyshortcuts={suggestion.shortcut?.aria}
                        tabIndex={-1}
                        data-start-suggestion={suggestion.id}
                        className={cn(
                          'dshx:flex dshx:min-h-9 dshx:w-full dshx:cursor-pointer dshx:items-center dshx:gap-2.5 dshx:rounded-(--dsw-radius-xl) dshx:border-[0.5px] dshx:border-input dshx:bg-card dshx:px-3 dshx:py-1 dshx:text-left dshx:text-foreground dshx:outline-none dshx:select-none',
                          'dshx:hover:bg-accent dshx:focus-visible:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                        )}
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
                    ))}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
