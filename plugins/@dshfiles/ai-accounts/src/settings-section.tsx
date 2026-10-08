import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ArrowUpRightIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { DISTRIBUTION_HINT, DISTRIBUTIONS } from './account-labels.js'
import { aiAccountsApi, type AccountsFile, type UsageHistoryMeta } from './api.js'
import { usePreferences } from './use-preferences.js'

const DELAYS = [400, 800, 1_500, 3_000] as const
const REFRESH_SECONDS = [15, 30, 60, 120, 300, 900] as const
const INTERVAL_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const
const RETENTION_DAYS = [30, 90, 180, 365] as const

const Group = (props: { readonly title: string; readonly description?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-4">
    <header className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <h3 className="dshx:text-sm dshx:font-semibold">{props.title}</h3>
      {props.description === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.description}</p>}
    </header>
    {props.children}
  </section>
)

const Row = (props: { readonly label: string; readonly hint?: string; readonly children: (id: string) => ReactNode }): JSX.Element => {
  const id = useId()
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-4 dshx:gap-y-1.5">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:basis-56 dshx:flex-col dshx:gap-0.5">
        <Label className="dshx:text-sm dshx:font-normal" htmlFor={id}>
          {props.label}
        </Label>
        {props.hint === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.hint}</p>}
      </div>
      {props.children(id)}
    </div>
  )
}

const NumberSelect = (props: {
  readonly id: string
  readonly value: number
  readonly options: readonly number[]
  readonly format: (value: number) => string
  readonly disabled?: boolean
  readonly onChange: (value: number) => void
}): JSX.Element => {
  const options = props.options.includes(props.value) ? props.options : [...props.options, props.value].sort((left, right) => left - right)
  return (
    <Select disabled={props.disabled} onValueChange={value => props.onChange(Number(value))} value={String(props.value)}>
      <SelectTrigger className="dshx:w-36" id={props.id} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option} value={String(option)}>
            {props.format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * AI Accounts in DSH Settings: how the accounts page saves, which quota
 * surfaces draw, and the Host's history schedule. Account profiles themselves
 * are edited on the AI Accounts page (and on Settings › Models).
 */
export const AiAccountsSettingsSection = (props: { readonly close: () => void; readonly openAccounts: () => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const settings = preferences.settings
  const [history, setHistory] = useState<UsageHistoryMeta | null>(null)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const saveModeId = useId()

  useEffect(() => {
    void accounts
      .historySettings()
      .then(setHistory)
      .catch(() => setNotice('The account host did not answer.'))
    void accounts
      .read()
      .then(setFile)
      .catch(() => undefined)
  }, [accounts])

  const write = (task: Promise<unknown>): void => {
    setNotice(null)
    void task.catch((cause: unknown) => setNotice(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`))
  }

  const saveHistory = (patch: Partial<Pick<UsageHistoryMeta, 'intervalMinutes' | 'retentionDays'>>): void => {
    if (history === null) return
    write(
      accounts
        .saveHistorySettings({ intervalMinutes: patch.intervalMinutes ?? history.intervalMinutes, retentionDays: patch.retentionDays ?? history.retentionDays })
        .then(setHistory),
    )
  }

  const readOnly = !settings.writable

  return (
    <div className="dshx-root dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:pb-4">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
          <h2 className="dshx:text-base dshx:font-semibold">AI Accounts</h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">Codex, Claude, OpenCode Go, Command Code and Cursor accounts side by side.</p>
        </div>
        <Button
          onClick={() => {
            props.close()
            props.openAccounts()
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArrowUpRightIcon />
          Open AI Accounts
        </Button>
      </header>

      {settings.error?.kind === 'namespace-unregistered' || settings.error?.kind === 'provider-unavailable' ? (
        <Alert variant="warning">
          <AlertDescription>Restart DSH to load these preferences; the running Host predates them. Defaults apply until then.</AlertDescription>
        </Alert>
      ) : readOnly && settings.status === 'ready' ? (
        <Alert variant="warning">
          <AlertDescription>These preferences are read-only in this browser.</AlertDescription>
        </Alert>
      ) : null}
      {notice === null ? null : (
        <Alert role="status" variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Group description="How edits on the accounts page are written." title="Editing">
        <RadioGroup
          aria-labelledby={saveModeId}
          className="dshx:flex dshx:flex-col dshx:gap-2"
          disabled={readOnly}
          onValueChange={value => write(settings.set('saveMode', value === 'manual' ? 'manual' : 'auto'))}
          value={preferences.saveMode}
        >
          <span className="dshx:sr-only" id={saveModeId}>
            Save mode
          </span>
          {(
            [
              ['auto', 'Automatic', 'Each edit saves itself after a short pause, with a saved/saving indicator.'],
              ['manual', 'Manual', 'Edits wait for Save changes; Revert discards them.'],
            ] as const
          ).map(([value, label, hint]) => (
            <Label className="dshx:flex dshx:items-start dshx:gap-2.5 dshx:font-normal" key={value}>
              <RadioGroupItem className="dshx:mt-0.5" value={value} />
              <span className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-sm">{label}</span>
                <span className="dshx:text-xs dshx:text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <Row hint="Pause after the last change before an automatic save." label="Auto-save delay">
          {id => (
            <NumberSelect
              disabled={readOnly || preferences.saveMode === 'manual'}
              format={value => (value < 1_000 ? `${String(value)} ms` : `${String(value / 1_000)} s`)}
              id={id}
              onChange={value => write(settings.set('autoSaveDelayMs', value))}
              options={DELAYS}
              value={preferences.autoSaveDelayMs}
            />
          )}
        </Row>
        {file === null ? null : (
          <Row hint={DISTRIBUTION_HINT[file.distribution]} label="Spread requests">
            {id => (
              <Select
                onValueChange={value => {
                  const distribution = DISTRIBUTIONS.find(candidate => candidate === value)
                  if (distribution !== undefined) write(accounts.setDistribution({ distribution }).then(setFile))
                }}
                value={file.distribution}
              >
                <SelectTrigger className="dshx:w-36" id={id} size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISTRIBUTIONS.map(value => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Row>
        )}
      </Group>

      <Group description="Where current quota is shown." title="Usage surfaces">
        <Row hint="Compact usage button in the sidebar footer; its popover lists every account." label="Sidebar footer button">
          {id => <Switch checked={preferences.footerButton} disabled={readOnly} id={id} onCheckedChange={value => write(settings.set('footerButton', value))} />}
        </Row>
        <Row hint="Draggable tab pinned to a window edge." label="Edge overlay">
          {id => <Switch checked={preferences.edgeWidget} disabled={readOnly} id={id} onCheckedChange={value => write(settings.set('edgeWidget', value))} />}
        </Row>
        <Row hint="Lists and edits these accounts at the bottom of Settings › Models." label="Accounts on the Models page">
          {id => (
            <Switch checked={preferences.modelsPageAccounts} disabled={readOnly} id={id} onCheckedChange={value => write(settings.set('modelsPageAccounts', value))} />
          )}
        </Row>
        <Row hint="How often open surfaces ask for fresh quota. Surfaces share one Host reading." label="Refresh usage every">
          {id => (
            <NumberSelect
              disabled={readOnly}
              format={value => (value < 60 ? `${String(value)} s` : `${String(value / 60)} min`)}
              id={id}
              onChange={value => write(settings.set('usageRefreshSeconds', value))}
              options={REFRESH_SECONDS}
              value={preferences.usageRefreshMs / 1000}
            />
          )}
        </Row>
      </Group>

      <Group description="The Host records one quota snapshot per enabled account on this schedule." title="Usage history">
        <Row label="Record every">
          {id => (
            <NumberSelect
              disabled={history === null}
              format={value => `${String(value)} min`}
              id={id}
              onChange={intervalMinutes => saveHistory({ intervalMinutes })}
              options={INTERVAL_MINUTES}
              value={history?.intervalMinutes ?? 5}
            />
          )}
        </Row>
        <Row label="Keep history for">
          {id => (
            <NumberSelect
              disabled={history === null}
              format={value => `${String(value)} days`}
              id={id}
              onChange={retentionDays => saveHistory({ retentionDays })}
              options={RETENTION_DAYS}
              value={history?.retentionDays ?? 90}
            />
          )}
        </Row>
      </Group>
    </div>
  )
}
