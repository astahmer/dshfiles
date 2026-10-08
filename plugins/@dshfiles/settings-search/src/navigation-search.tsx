import type { ConfigForm, SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useSettings } from '@dshfiles/dshx/client'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { searchSettingsTargets, type SettingsSearchResult } from './settings-index.js'
import type { SettingsSearchTranslate } from './locales.js'
import { SettingsFieldEditor } from './settings-field-editor.js'
import { settingsSearchSettings } from './settings.js'
import { useSettingsMirror } from './use-settings-mirror.js'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'

const MAX_QUERY_LENGTH = 200
const DEFAULT_NAV_WIDTH = 188

interface SettingsNavigationSearchProps {
  readonly describe: SettingsDescribeFace
  readonly getForm: (entryId: string) => ConfigForm<unknown>
  readonly t: SettingsSearchTranslate
}

interface OpenEditor {
  readonly result: SettingsSearchResult
  readonly left: number
}

/**
 * Occupies the Settings title seat above the section navigation (BB parity: a compact search field over the nav
 * with results inline). The seat cannot switch the shell's active section, so a chosen result opens its live
 * editor over the content column inside the same dialog instead of navigating to the owning section.
 */
export const SettingsNavigationSearch = (props: SettingsNavigationSearchProps): JSX.Element => {
  const t = props.t
  const preferences = useSettings(settingsSearchSettings)
  const ready = preferences.status === 'ready' && preferences.value !== undefined
  const enabled = ready ? preferences.value.navigationSearch : true
  const focusOnOpen = ready ? preferences.value.focusOnOpen : false
  const maxResults = ready ? preferences.value.maxResults : 30
  const { namespaces, results } = useSettingsMirror(props.describe)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [editor, setEditor] = useState<OpenEditor | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (!focusOnOpen || focused.current) return
    focused.current = true
    inputRef.current?.focus({ preventScroll: true })
  }, [focusOnOpen])

  const trimmedQuery = query.trim()
  const matched = useMemo(() => searchSettingsTargets(results, trimmedQuery), [results, trimmedQuery])
  const visible = matched.slice(0, maxResults)
  const boundedActiveIndex = Math.min(activeIndex, Math.max(visible.length - 1, 0))
  const editorNamespace = editor === null ? undefined : namespaces.find(namespace => namespace.ns === editor.result.target.entryId)

  const openEditor = (result: SettingsSearchResult): void => {
    const nav = rootRef.current?.closest('nav')
    setEditor({ result, left: nav?.getBoundingClientRect().width ?? DEFAULT_NAV_WIDTH })
  }

  const closeEditor = (): void => {
    setEditor(null)
    inputRef.current?.focus({ preventScroll: true })
  }

  const clear = (): void => {
    setQuery('')
    setActiveIndex(0)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, visible.length - 1))
    }
    if (event.key === 'ArrowUp' && visible.length > 0) {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    }
    const active = visible[boundedActiveIndex]
    if (event.key === 'Enter' && active !== undefined) {
      event.preventDefault()
      openEditor(active)
    }
    if (event.key === 'Escape' && query.length > 0) {
      event.preventDefault()
      clear()
    }
  }

  if (!enabled) return <>{t('navigationTitle')}</>

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-2" ref={rootRef}>
      <span>{t('navigationTitle')}</span>
      <div className="dshx:-mx-1 dshx:flex dshx:flex-col dshx:gap-1">
        <InputGroup className="dshx:h-7">
          <InputGroupAddon>
            <SearchIcon className="dshx:size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('searchSettings')}
            autoComplete="off"
            className="dshx:text-xs"
            maxLength={MAX_QUERY_LENGTH}
            onChange={event => {
              setQuery(event.currentTarget.value)
              setActiveIndex(0)
            }}
            onKeyDown={onInputKeyDown}
            placeholder={t('searchPlaceholder')}
            ref={inputRef}
            type="search"
            value={query}
          />
          {query.length > 0 && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t('clearSearch')} onClick={clear} size="icon-xs">
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <span aria-live="polite" className="dshx:px-1 dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
          {trimmedQuery.length === 0 ? '' : t(matched.length === 1 ? 'matchCountOne' : 'matchCountOther', { count: matched.length })}
        </span>
        {visible.length > 0 && (
          <div className="dshx:flex dshx:max-h-[min(50vh,360px)] dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:overscroll-contain">
            {visible.map((result, index) => (
              <button
                aria-current={index === boundedActiveIndex ? 'true' : undefined}
                className={cn(
                  'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border dshx:bg-card dshx:px-2 dshx:py-1.5 dshx:text-left dshx:font-normal dshx:transition-colors dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
                  index === boundedActiveIndex && 'dshx:bg-accent',
                  editor?.result.id === result.id && 'dshx:border-ring',
                )}
                key={result.id}
                onClick={() => openEditor(result)}
                ref={index === boundedActiveIndex ? element => element?.scrollIntoView({ block: 'nearest' }) : undefined}
                title={result.description.length > 0 ? result.description : undefined}
                type="button"
              >
                <span className="dshx:line-clamp-2 dshx:text-xs dshx:font-medium dshx:text-foreground">{result.title}</span>
                <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{result.context}</span>
              </button>
            ))}
          </div>
        )}
        {trimmedQuery.length > 0 && matched.length === 0 && (
          <p className="dshx:px-1 dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{t('noMatches')}</p>
        )}
      </div>
      {editor !== null && editorNamespace !== undefined && (
        <div
          className="dshx-root dshx:absolute dshx:inset-y-0 dshx:right-0 dshx:z-10 dshx:flex dshx:flex-col dshx:bg-popover dshx:text-sm dshx:font-normal dshx:text-popover-foreground"
          onKeyDown={event => {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            event.preventDefault()
            closeEditor()
          }}
          role="region"
          aria-label={editor.result.title}
          style={{ left: editor.left }}
        >
          <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-6 dshx:pt-5 dshx:pb-6">
            <SettingsFieldEditor
              form={props.getForm(editor.result.target.entryId)}
              key={editor.result.id}
              namespace={editorNamespace}
              onBack={closeEditor}
              result={editor.result}
              t={t}
            />
          </div>
        </div>
      )}
    </div>
  )
}
