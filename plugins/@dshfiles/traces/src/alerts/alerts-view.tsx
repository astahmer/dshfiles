import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { BellIcon, BellOffIcon, EllipsisIcon, PlayIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { TraceFormat } from '../format.js'
import { AlertRuleDialog, AlertRuleLabels } from './alert-rule-dialog.js'
import type { AlertEvent, AlertRule, AlertRuleDraft, AlertRuleView, AlertSeverity } from './alert-types.js'
import { tracesAlertsApi } from './alerts-api.js'
import type { TracesAlertsTranslate } from './alerts-locale.js'
import { alertsKeys, alertsOwnerMissing, alertsQueries } from './alerts-queries.js'

const numeric = 'dshx:text-right dshx:font-mono dshx:text-xs'

const severityVariant = (severity: AlertSeverity): 'destructive' | 'warning' | 'info' =>
  severity === 'critical' ? 'destructive' : severity === 'warning' ? 'warning' : 'info'

const severityLabel = (severity: AlertSeverity, t: TracesAlertsTranslate): string =>
  severity === 'critical' ? t('severityCritical') : severity === 'warning' ? t('severityWarning') : t('severityInfo')

/** A rule's value in its own unit: a share, milliseconds, spans per minute or a count. */
const formatValue = (rule: Pick<AlertRule, 'kind'>, value: number | null): string => {
  if (value === null) return '—'
  if (rule.kind === 'error-rate') return TraceFormat.percent(value)
  if (rule.kind === 'latency' || rule.kind === 'duration') return TraceFormat.duration(value)
  if (rule.kind === 'throughput') return `${value.toFixed(value < 10 ? 2 : 0)}/min`
  return String(Math.round(value))
}

const conditionOf = (rule: AlertRule, t: TracesAlertsTranslate): string => {
  const measure = rule.kind === 'latency' ? `p${String(rule.percentile)}` : AlertRuleLabels.kind(rule.kind, t).toLowerCase()
  const comparator = rule.kind === 'duration' || rule.comparator === 'above' ? '>' : '<'
  return `${measure} ${comparator} ${formatValue(rule, rule.threshold)} · ${String(rule.windowMinutes)} ${t('minutesShort')}`
}

const filterOf = (rule: AlertRule, t: TracesAlertsTranslate): string =>
  [
    rule.filter.operation ?? t('anySpan'),
    rule.filter.service ?? t('anyService'),
    ...(rule.filter.attribute === null ? [] : [`${rule.filter.attribute.key}=${rule.filter.attribute.value}`]),
  ].join(' · ')

const draftOf = (rule: AlertRule): AlertRuleDraft => ({
  id: rule.id,
  name: rule.name,
  kind: rule.kind,
  filter: rule.filter,
  windowMinutes: rule.windowMinutes,
  threshold: rule.threshold,
  comparator: rule.comparator,
  percentile: rule.percentile,
  minSamples: rule.minSamples,
  severity: rule.severity,
  enabled: rule.enabled,
  notify: rule.notify,
  markThreads: rule.markThreads,
})

type NotificationState = 'unsupported' | NotificationPermission

const notificationState = (): NotificationState =>
  typeof window === 'undefined' || !('Notification' in window) ? 'unsupported' : window.Notification.permission

const NotificationPermissionButton = (props: { readonly t: TracesAlertsTranslate }): JSX.Element | null => {
  const [permission, setPermission] = useState<NotificationState>(notificationState)
  if (permission === 'unsupported') return null
  if (permission === 'granted')
    return (
      <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
        <BellIcon className="dshx:size-3.5" /> {props.t('notificationsOn')}
      </span>
    )
  if (permission === 'denied')
    return (
      <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
        <BellOffIcon className="dshx:size-3.5" /> {props.t('notificationsBlocked')}
      </span>
    )
  return (
    <Button variant="outline" size="sm" onClick={() => void window.Notification.requestPermission().then(setPermission)}>
      <BellIcon /> <span className="dshx:@max-pane-compact:sr-only">{props.t('notificationsAllow')}</span>
    </Button>
  )
}

class AlertBadges {
  static readonly isMuted = (rule: AlertRule, now: number): boolean => rule.mutedUntil !== null && rule.mutedUntil > now

  static readonly muted = (rule: AlertRule, now: number, t: TracesAlertsTranslate): JSX.Element | null =>
    rule.mutedUntil !== null && rule.mutedUntil > now ? (
      <Badge variant="muted">
        <BellOffIcon /> {t('mutedUntil')} {TraceFormat.clock(rule.mutedUntil)}
      </Badge>
    ) : null

  static readonly status = (rule: AlertRuleView, t: TracesAlertsTranslate): JSX.Element =>
    !rule.enabled ? (
      <Badge variant="muted">{t('statusOff')}</Badge>
    ) : rule.state.status === 'firing' ? (
      <Badge variant="destructive">{t('statusFiring')}</Badge>
    ) : (
      <Badge variant="success">{t('statusOk')}</Badge>
    )
}

const ThreadLinks = (props: {
  readonly sessionIds: readonly string[]
  readonly onOpenThread: (sessionId: string) => string | null
  readonly t: TracesAlertsTranslate
}): JSX.Element | null => {
  const [problem, setProblem] = useState<string | null>(null)
  if (props.sessionIds.length === 0) return null
  return (
    <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
      {props.sessionIds.slice(0, 3).map(sessionId => (
        <Button
          key={sessionId}
          variant="link"
          size="sm"
          className="dshx:h-auto dshx:p-0 dshx:font-mono"
          onClick={() => setProblem(props.onOpenThread(sessionId))}
        >
          {props.t('openThread')} {sessionId.slice(-8)}
        </Button>
      ))}
      {problem === null ? null : <span className="dshx:text-destructive">{problem}</span>}
    </span>
  )
}

const FiringList = (props: {
  readonly now: number
  readonly rules: readonly AlertRuleView[]
  readonly history: readonly AlertEvent[]
  readonly onOpenTrace: (traceId: string) => void
  readonly onOpenThread: (sessionId: string) => string | null
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  const firing = props.rules.filter(rule => rule.state.status === 'firing')
  if (firing.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{t('noFiring')}</p>
  return (
    <ul className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={t('firingAlerts')}>
      {firing.map(rule => {
        const opened = props.history.find(event => event.ruleId === rule.id && event.kind === 'firing')
        return (
          <li
            key={rule.id}
            data-rule-id={rule.id}
            className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-destructive/40 dshx:bg-destructive/5 dshx:p-3"
          >
            <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
              <Badge variant={severityVariant(rule.severity)}>{severityLabel(rule.severity, t)}</Badge>
              <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{rule.name}</span>
              <span className="dshx:font-mono dshx:text-xs dshx:text-destructive">{formatValue(rule, rule.state.value)}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">{conditionOf(rule, t)}</span>
              {AlertBadges.muted(rule, props.now, t)}
            </div>
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:text-[11px] dshx:text-muted-foreground">
              {rule.state.since === null ? null : (
                <span>
                  {t('statusFiring')} {TraceFormat.clock(rule.state.since)}
                </span>
              )}
              <span>
                {rule.state.sampleCount} {t('spansWord')}
              </span>
              {opened?.sampleTraceId === null || opened === undefined ? null : (
                <Button variant="link" size="sm" className="dshx:h-auto dshx:p-0" onClick={() => props.onOpenTrace(opened.sampleTraceId ?? '')}>
                  {t('openSampleTrace')}
                </Button>
              )}
              {opened === undefined ? null : <ThreadLinks sessionIds={opened.sessionIds} onOpenThread={props.onOpenThread} t={t} />}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const RulesTable = (props: {
  readonly now: number
  readonly rules: readonly AlertRuleView[]
  readonly onEdit: (rule: AlertRule) => void
  readonly onToggle: (rule: AlertRule, enabled: boolean) => void
  readonly onMute: (rule: AlertRule, minutes: number | null) => void
  readonly onDelete: (rule: AlertRule) => void
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  if (props.rules.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{t('noRules')}</p>
  return (
    <Table aria-label={t('rules')}>
      <TableHeader>
        <TableRow>
          <TableHead className="dshx:w-12">{t('enabled')}</TableHead>
          <TableHead>{t('ruleName')}</TableHead>
          <TableHead className="dshx:w-52 dshx:@max-pane-compact:hidden">{t('threshold')}</TableHead>
          <TableHead className="dshx:w-24 dshx:text-right">{t('severity')}</TableHead>
          <TableHead className="dshx:w-20 dshx:text-right">{t('lastValue')}</TableHead>
          <TableHead className="dshx:w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rules.map(rule => (
          <TableRow key={rule.id} data-rule-id={rule.id} data-status={rule.enabled ? rule.state.status : 'off'}>
            <TableCell>
              <Switch aria-label={`${t('enabled')} ${rule.name}`} checked={rule.enabled} onCheckedChange={checked => props.onToggle(rule, checked)} />
            </TableCell>
            <TableCell className="dshx:max-w-0">
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{rule.name}</span>
                  {AlertBadges.status(rule, t)}
                  {rule.builtin ? (
                    <Badge variant="outline" className="dshx:@max-pane-narrow:hidden">
                      {t('builtin')}
                    </Badge>
                  ) : null}
                  {AlertBadges.muted(rule, props.now, t)}
                </span>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{filterOf(rule, t)}</span>
              </div>
            </TableCell>
            <TableCell className="dshx:text-xs dshx:@max-pane-compact:hidden">{conditionOf(rule, t)}</TableCell>
            <TableCell className="dshx:text-right">
              <Badge variant={severityVariant(rule.severity)}>{severityLabel(rule.severity, t)}</Badge>
            </TableCell>
            <TableCell className={numeric}>{rule.enabled ? formatValue(rule, rule.state.value) : '—'}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`${t('editRule')} ${rule.name}`}>
                    <EllipsisIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="dshx-root">
                  <DropdownMenuItem onSelect={() => props.onEdit(rule)}>{t('editRule')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {AlertBadges.isMuted(rule, props.now) ? (
                    <DropdownMenuItem onSelect={() => props.onMute(rule, null)}>{t('unmute')}</DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onSelect={() => props.onMute(rule, 60)}>{t('mute1h')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => props.onMute(rule, 240)}>{t('mute4h')}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => props.onMute(rule, 1_440)}>{t('mute24h')}</DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => props.onDelete(rule)}>
                    {t('deleteRule')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const HistoryList = (props: {
  readonly history: readonly AlertEvent[]
  readonly rules: readonly AlertRule[]
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  if (props.history.length === 0) return <p className="dshx:text-sm dshx:text-muted-foreground">{t('noHistory')}</p>
  return (
    <ol className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border dshx:rounded-md dshx:border dshx:border-border" aria-label={t('history')}>
      {props.history.map(event => {
        const rule = props.rules.find(candidate => candidate.id === event.ruleId)
        return (
          <li
            key={event.id}
            data-event-kind={event.kind}
            className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-3 dshx:py-2 dshx:text-xs"
          >
            <span className="dshx:w-20 dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{TraceFormat.clock(event.at)}</span>
            <Badge variant={event.kind === 'firing' ? severityVariant(event.severity) : 'success'}>
              {event.kind === 'firing' ? t('eventFiring') : t('eventResolved')}
            </Badge>
            <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{event.ruleName}</span>
            <span className="dshx:font-mono dshx:text-muted-foreground">{rule === undefined ? event.value : formatValue(rule, event.value)}</span>
            {event.reason === 'threshold' ? null : (
              <span className="dshx:text-muted-foreground">{event.reason === 'disabled' ? t('reasonDisabled') : t('reasonRemoved')}</span>
            )}
            {event.muted ? <BellOffIcon aria-label={t('muteMenu')} className="dshx:size-3.5 dshx:text-muted-foreground" /> : null}
            {event.threadsMarked > 0 ? (
              <span className="dshx:text-muted-foreground">
                {event.threadsMarked} {t('threadsMarked')}
              </span>
            ) : null}
            {event.deliveryError === null ? null : <span className="dshx:text-warning">{event.deliveryError}</span>}
          </li>
        )
      })}
    </ol>
  )
}

/** The Alerts tab: what fires now, every rule with its switch and actions, and the bounded history. */
export const AlertsView = (props: {
  readonly onOpenTrace: (traceId: string) => void
  readonly onOpenThread: (sessionId: string) => string | null
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  const client = useApi(tracesAlertsApi)
  const queryClient = useQueryClient()
  const stateQuery = useQuery(alertsQueries.state(client))
  const [editing, setEditing] = useState<{ readonly rule: AlertRule | null } | null>(null)
  const [deleting, setDeleting] = useState<AlertRule | null>(null)
  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: alertsKeys.all })
  const save = useMutation({ mutationFn: (draft: AlertRuleDraft) => client.save(draft), onSuccess: invalidate })
  const mute = useMutation({
    mutationFn: (input: { readonly id: string; readonly minutes: number | null }) => client.mute({ ...input }),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => client.remove({ id, confirm: true }), onSuccess: invalidate })
  const evaluate = useMutation({ mutationFn: () => client.evaluate({}), onSuccess: invalidate })

  if (stateQuery.isError)
    return (
      <Alert variant={alertsOwnerMissing(stateQuery.error) ? 'default' : 'destructive'}>
        <AlertDescription>{alertsOwnerMissing(stateQuery.error) ? t('alertsUnavailable') : errorMessage(stateQuery.error, t('loadFailed'))}</AlertDescription>
      </Alert>
    )
  const snapshot = stateQuery.data
  if (snapshot === undefined) return <p className="dshx:text-sm dshx:text-muted-foreground">…</p>
  const mutationError = [save, mute, remove, evaluate].find(mutation => mutation.isError)?.error
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-4" data-testid="traces-alerts-view" data-firing={snapshot.firing}>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <p className="dshx:min-w-0 dshx:max-w-prose dshx:text-sm dshx:text-muted-foreground">{t('alertsSubtitle')}</p>
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <span className="dshx:text-xs dshx:text-muted-foreground">
            {snapshot.lastEvaluatedAt === null ? t('neverEvaluated') : `${t('lastEvaluated')} ${TraceFormat.clock(snapshot.lastEvaluatedAt)}`}
          </span>
          <NotificationPermissionButton t={t} />
          <Button variant="outline" size="sm" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
            <PlayIcon /> <span className="dshx:@max-pane-narrow:sr-only">{t('evaluateNow')}</span>
          </Button>
          <Button size="sm" onClick={() => setEditing({ rule: null })}>
            <PlusIcon /> {t('newRule')}
          </Button>
        </div>
      </div>
      {mutationError === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(mutationError, t('saveFailed'))}</AlertDescription>
        </Alert>
      )}
      <section className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={t('firingAlerts')}>
        <h2 className="dshx:text-sm dshx:font-semibold">{t('firingAlerts')}</h2>
        <FiringList
          now={stateQuery.dataUpdatedAt}
          rules={snapshot.rules}
          history={snapshot.history}
          onOpenTrace={props.onOpenTrace}
          onOpenThread={props.onOpenThread}
          t={t}
        />
      </section>
      <section className="dshx:flex dshx:flex-col dshx:gap-2">
        <h2 className="dshx:text-sm dshx:font-semibold">{t('rules')}</h2>
        <RulesTable
          now={stateQuery.dataUpdatedAt}
          rules={snapshot.rules}
          onEdit={rule => setEditing({ rule })}
          onToggle={(rule, enabled) => save.mutate({ ...draftOf(rule), enabled })}
          onMute={(rule, minutes) => mute.mutate({ id: rule.id, minutes })}
          onDelete={setDeleting}
          t={t}
        />
      </section>
      <section className="dshx:flex dshx:flex-col dshx:gap-2">
        <h2 className="dshx:text-sm dshx:font-semibold">{t('history')}</h2>
        <HistoryList history={snapshot.history} rules={snapshot.rules} t={t} />
      </section>
      <AlertRuleDialog
        open={editing !== null}
        rule={editing?.rule ?? null}
        onOpenChange={open => {
          if (!open) setEditing(null)
        }}
        onSave={draft => save.mutateAsync(draft)}
        t={t}
      />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={open => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteRuleTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} · {t('deleteRuleBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting !== null) remove.mutate(deleting.id)
              }}
            >
              {t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The firing count the panel shows on its Alerts tab and above its tabs; null while unknown or on a Host without alerts. */
export const useFiringCount = (): number | null => {
  const client = useApi(tracesAlertsApi)
  const feed = useQuery(alertsQueries.feed(client, null))
  return feed.data?.firing ?? null
}
