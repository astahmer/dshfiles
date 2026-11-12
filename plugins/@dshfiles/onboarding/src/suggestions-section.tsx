import { isApiError } from '@dshfiles/dshx/api'
import { PageSection } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { LightbulbIcon, LocateFixedIcon, RotateCcwIcon, SearchIcon, SettingsIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState, type ReactNode } from 'react'
import type { Suggestion, Suggestions, SuggestionsInput } from './suggestions-model.js'
import { SuggestionsWindow, type FeaturedDay } from './suggestions-window.js'

export interface SuggestionsSectionProps {
  readonly enabled: boolean
  readonly loadSuggestions: (input: SuggestionsInput, signal: AbortSignal) => Promise<Suggestions>
  /** Opens Settings at the `suggestions` switch; absent when no Settings page is registered. */
  readonly openSetting: (() => void) | null
  readonly showWhere: (featureKey: string) => void
  /** Search Getting started's features for this text. */
  readonly findFeature: (text: string) => void
  readonly featured: FeaturedDay | null
  readonly remember: (next: FeaturedDay) => void
  readonly dismissed: readonly string[]
  readonly dismiss: (rule: string) => void
  readonly restoreDismissed: () => void
  /** The browser's local day, `YYYY-MM-DD`. */
  readonly today: string
}

const HEADING = 'Suggestions'

const SuggestionItem = (props: {
  readonly suggestion: Suggestion
  readonly prominent: boolean
  readonly showWhere: (featureKey: string) => void
  readonly findFeature: (text: string) => void
  readonly dismiss: (rule: string) => void
}): ReactNode => {
  const { suggestion } = props
  const row = suggestion.feature
  return (
    <li
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:py-2.5',
        props.prominent && 'dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:p-3',
      )}
      data-suggestion={suggestion.rule}
      data-feature-key={row.key}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        {props.prominent ? <LightbulbIcon aria-hidden className="dshx:mt-0.5 dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" /> : null}
        <div className="dshx:min-w-0 dshx:flex-1">
          <p className="dshx:min-w-0 dshx:text-sm dshx:font-medium">{row.title}</p>
          <p className="dshx:text-xs dshx:text-muted-foreground">{suggestion.why}</p>
          <p className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{suggestion.evidence}</p>
        </div>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
        {row.walkable ? (
          <Button aria-label={`Show me where: ${row.title}`} onClick={() => props.showWhere(row.key)} size="sm" variant="outline">
            <LocateFixedIcon /> Show me where
          </Button>
        ) : null}
        <Button aria-label={`Find in features: ${row.title}`} onClick={() => props.findFeature(row.title)} size="sm" variant="ghost">
          <SearchIcon /> Find in features
        </Button>
        <Button aria-label={`Dismiss: ${row.title}`} onClick={() => props.dismiss(suggestion.rule)} size="sm" variant="ghost">
          <XIcon /> Dismiss
        </Button>
      </div>
    </li>
  )
}

const Off = (props: { readonly openSetting: (() => void) | null }): ReactNode => (
  <PageSection data-suggestions="off" heading={HEADING}>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2">
      <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:text-muted-foreground">
        Off: turn it on to get features suggested from your local tool use. Nothing is read until then.
      </p>
      {props.openSetting === null ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">Settings › Onboarding › suggestions</p>
      ) : (
        <Button onClick={props.openSetting} size="sm" variant="outline">
          <SettingsIcon /> Turn on in Settings
        </Button>
      )}
    </div>
  </PageSection>
)

/** Features the user has not used yet, from local tool use; nothing is requested while the setting is off. */
export const SuggestionsSection = (props: SuggestionsSectionProps): ReactNode => {
  const [showAll, setShowAll] = useState(false)
  const query = useQuery({
    queryKey: ['onboarding', 'suggestions'],
    queryFn: ({ signal }) => props.loadSuggestions({}, signal),
    enabled: props.enabled,
    retry: false,
    staleTime: 10 * 60_000,
  })
  const value = query.data
  const window =
    value?.state === 'ready'
      ? SuggestionsWindow.view({ suggestions: value.suggestions, dismissed: props.dismissed, featured: props.featured, today: props.today })
      : null
  const remember = window?.remember ?? null
  const rememberDay = props.remember
  useEffect(() => {
    if (remember !== null) rememberDay(remember)
  }, [remember, rememberDay])

  const turnedOffSince = query.isError && isApiError(query.error) && query.error.remoteCode === 'suggestions-off'
  if (!props.enabled || turnedOffSince) return <Off openSetting={props.openSetting} />
  if (query.isError)
    return (
      <PageSection data-suggestions="error" heading={HEADING}>
        <p className="dshx:text-sm dshx:text-muted-foreground">
          Suggestions could not be loaded. Try again; if Getting started was updated since DSH started, restart DSH from the bottom of the rail first.
        </p>
        <div>
          <Button onClick={() => void query.refetch()} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      </PageSection>
    )
  if (value === undefined) return null
  if (value.state !== 'ready')
    return (
      <PageSection data-suggestions={value.state} heading={HEADING}>
        <p className="dshx:text-sm dshx:text-muted-foreground">{value.reason}</p>
        <div>
          <Button onClick={() => void query.refetch()} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      </PageSection>
    )
  if (window === null) return null

  const restore =
    window.dismissed > 0 ? (
      <Button onClick={props.restoreDismissed} size="sm" variant="ghost">
        <RotateCcwIcon /> Restore {String(window.dismissed)} dismissed
      </Button>
    ) : null
  const item = (suggestion: Suggestion, prominent: boolean): ReactNode => (
    <SuggestionItem
      dismiss={props.dismiss}
      findFeature={props.findFeature}
      key={suggestion.rule}
      prominent={prominent}
      showWhere={props.showWhere}
      suggestion={suggestion}
    />
  )

  return (
    <PageSection data-suggestions="ready" heading={HEADING} meta={`last ${String(value.days)} days`}>
      {window.featured === null && window.rest.length === 0 ? (
        <p className="dshx:text-sm dshx:text-muted-foreground" data-suggestions-empty="">
          {value.suggestions.length === 0
            ? `Nothing in the last ${String(value.days)} days of tool use points to a feature you have not used yet.`
            : 'Every suggestion is dismissed.'}
        </p>
      ) : null}
      {window.featured === null ? null : <ul aria-label="Suggestion of the day">{item(window.featured, true)}</ul>}
      {window.rest.length === 0 ? null : (
        <div>
          <Button aria-expanded={showAll} onClick={() => setShowAll(!showAll)} size="sm" variant="ghost">
            {showAll ? 'Hide other suggestions' : `Show all suggestions (${String(window.rest.length)})`}
          </Button>
        </div>
      )}
      {showAll && window.rest.length > 0 ? (
        <ul aria-label="Other suggestions" className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
          {window.rest.map(suggestion => item(suggestion, false))}
        </ul>
      ) : null}
      {restore === null ? null : <div>{restore}</div>}
    </PageSection>
  )
}
