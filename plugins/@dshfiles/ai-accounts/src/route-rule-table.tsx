import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import type { ReactNode } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'

/** Every model of a route: the `route/*` rule form. */
export const ALL_MODELS = '*'

/** One `route/model = value` rule as the table edits it. */
export interface RouteRule<Value> {
  readonly route: string
  readonly model: string
  readonly value: Value
}

/**
 * The record a setting stores (`{ 'claude_work/*': 'long' }`) as rows, in key order. The route is the text before the
 * first `/`: account routes never contain one, model ids may.
 */
export const RouteRules = {
  of: <Value,>(record: Readonly<Record<string, Value>>): readonly RouteRule<Value>[] =>
    Object.entries(record).flatMap(([key, value]) => {
      const slash = key.indexOf('/')
      return slash <= 0 || slash === key.length - 1 ? [] : [{ route: key.slice(0, slash), model: key.slice(slash + 1), value }]
    }),
  record: <Value,>(rules: readonly RouteRule<Value>[]): Record<string, Value> =>
    Object.fromEntries(rules.filter(rule => rule.route !== '' && rule.model !== '').map(rule => [`${rule.route}/${rule.model}`, rule.value])),
}

const ModelSelect = (props: {
  readonly route: string
  readonly value: string
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (model: string) => void
}): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const catalog = useQuery({ ...aiAccountsQueries.catalog(accounts, props.route), enabled: props.route !== '' })
  const models = catalog.data?.models ?? []
  // A rule may name a model the catalog no longer lists (renamed, removed): keep it selectable rather than drop it.
  const known = props.value === ALL_MODELS || models.some(model => model.id === props.value)
  return (
    <Select disabled={props.disabled} value={props.value} onValueChange={props.onChange}>
      <SelectTrigger aria-label={props.label} className="dshx:h-8 dshx:w-full dshx:min-w-0 dshx:text-xs dshx:pointer-coarse:h-11" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_MODELS}>All models</SelectItem>
        {known ? null : <SelectItem value={props.value}>{props.value}</SelectItem>}
        {models.map(model => (
          <SelectItem key={model.id} value={model.id}>
            {model.name === '' ? model.id : model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Per-account, per-model rules (cache retention, cache lifetimes) as a table of kit Selects instead of raw
 * `route/model = value` lines (b:ysaj). Each change saves at once; the caller keeps an "Edit as text" escape hatch.
 */
export const RouteRuleTable = <Value,>(props: {
  readonly label: string
  readonly rules: readonly RouteRule<Value>[]
  readonly disabled: boolean
  readonly defaultValue: Value
  readonly renderValue: (input: { readonly value: Value; readonly label: string; readonly onChange: (value: Value) => void }) => ReactNode
  readonly onChange: (rules: readonly RouteRule<Value>[]) => void
}): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const file = useQuery(aiAccountsQueries.file(accounts))
  const routes = (file.data?.accounts ?? []).map(account => ({
    id: account.instanceId,
    name: account.displayName.trim() === '' ? account.instanceId : account.displayName,
  }))
  const replace = (index: number, next: RouteRule<Value>): void => props.onChange(props.rules.map((rule, at) => (at === index ? next : rule)))
  const firstRoute = routes[0]?.id
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-1.5" role="group" aria-label={props.label}>
      {props.rules.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No rules: every model uses its provider default.</p> : null}
      {props.rules.map((rule, index) => {
        const known = routes.some(route => route.id === rule.route)
        return (
          <div
            className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,7rem)_auto] dshx:items-center dshx:gap-1.5 dshx:@max-pane-narrow:grid-cols-[minmax(0,1fr)_auto] dshx:@max-pane-narrow:rounded-md dshx:@max-pane-narrow:border dshx:@max-pane-narrow:border-border dshx:@max-pane-narrow:p-2"
            data-route-rule={`${rule.route}/${rule.model}`}
            key={`${String(index)}:${rule.route}/${rule.model}`}
          >
            <Select disabled={props.disabled} value={rule.route} onValueChange={route => replace(index, { ...rule, route, model: ALL_MODELS })}>
              <SelectTrigger
                aria-label={`${props.label}: account`}
                className="dshx:h-8 dshx:w-full dshx:min-w-0 dshx:text-xs dshx:pointer-coarse:h-11"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {known ? null : <SelectItem value={rule.route}>{rule.route}</SelectItem>}
                {routes.map(route => (
                  <SelectItem key={route.id} value={route.id}>
                    {route.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="dshx:min-w-0 dshx:@max-pane-narrow:col-start-1">
              <ModelSelect
                disabled={props.disabled}
                label={`${props.label}: model`}
                route={rule.route}
                value={rule.model}
                onChange={model => replace(index, { ...rule, model })}
              />
            </div>
            <div className="dshx:min-w-0 dshx:@max-pane-narrow:col-start-1">
              {props.renderValue({ value: rule.value, label: `${props.label}: value`, onChange: value => replace(index, { ...rule, value }) })}
            </div>
            <Button
              aria-label={`Remove rule ${rule.route}/${rule.model}`}
              className="dshx:pointer-coarse:size-11 dshx:@max-pane-narrow:col-start-2 dshx:@max-pane-narrow:row-start-1"
              disabled={props.disabled}
              onClick={() => props.onChange(props.rules.filter((_rule, at) => at !== index))}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        )
      })}
      <div>
        <Button
          disabled={props.disabled || firstRoute === undefined}
          onClick={() => {
            if (firstRoute !== undefined) props.onChange([...props.rules, { route: firstRoute, model: ALL_MODELS, value: props.defaultValue }])
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden />
          Add rule
        </Button>
      </div>
      {file.isError ? (
        <p className="dshx:text-xs dshx:text-destructive">Accounts are unavailable, so rules can only be edited as text. Reopen Settings to retry.</p>
      ) : null}
    </div>
  )
}
