import { errorMessage } from '@dshfiles/plugin-ui/query'
import type { JevUsageView } from './api.js'
import { UsageFormattingModel } from './format.js'

const Panel = (props: {
  readonly title: string
  readonly description?: string
  readonly className?: string
  readonly children: React.ReactNode
}): JSX.Element => (
  <section
    className={`dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:p-4 ${props.className ?? ''}`}
  >
    <header className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <h2 className="dshx:text-sm dshx:font-semibold dshx:text-foreground" data-usage-jev-card-title>
        {props.title}
      </h2>
      {props.description === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.description}</p>}
    </header>
    {props.children}
  </section>
)

const Tile = (props: { readonly label: string; readonly value: string; readonly detail?: React.ReactNode }): JSX.Element => (
  <div className="dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-3">
    <p className="dshx:text-xs dshx:text-muted-foreground">{props.label}</p>
    <p className="dshx:truncate dshx:text-lg dshx:font-semibold dshx:text-foreground">{props.value}</p>
    {props.detail === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.detail}</p>}
  </div>
)

export const JevUsageCard = (props: { readonly usage: JevUsageView | undefined; readonly error: unknown; readonly failed: boolean }): JSX.Element => {
  const credentialRows = props.usage?.byCredential ?? []
  return (
    <Panel title="Jev API usage" description="DSH-local estimated usage · $0.042 per 1M input tokens · output free. Not provider account balance.">
      {props.failed ? (
        <p className="dshx:text-xs dshx:text-destructive">{errorMessage(props.error, 'Jev usage could not be loaded.')}</p>
      ) : props.usage === undefined ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">Loading…</p>
      ) : (
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2">
            <Tile label="Jev calls" value={props.usage.calls.toLocaleString()} detail={`${props.usage.failed.toLocaleString()} failed`} />
            <Tile
              label="Input tokens"
              value={UsageFormattingModel.formatCount(props.usage.inputTokens)}
              detail={`${UsageFormattingModel.formatCount(props.usage.outputTokens)} output tokens · free`}
            />
            <Tile label="Estimated cost" value={UsageFormattingModel.formatCost(props.usage.estimatedCostUsd)} detail="Input-token list-price estimate" />
          </div>
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:text-xs dshx:font-medium dshx:text-foreground">Usage by configured credential</p>
            {credentialRows.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No Jev requests recorded in this period.</p> : null}
            {credentialRows.map(row => (
              <p className="dshx:flex dshx:justify-between dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" key={row.credential}>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-mono! dshx:text-foreground">{row.credential}</span>
                <span className="dshx:shrink-0">
                  {row.calls.toLocaleString()} calls · {UsageFormattingModel.formatCount(row.inputTokens)} input ·{' '}
                  {UsageFormattingModel.formatCost(row.estimatedCostUsd)} · Backlog {row.backlogCalls} / Memory {row.memoryCalls}
                </span>
              </p>
            ))}
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {props.usage.callsWithoutInputUsage === 0
              ? 'Usage reported for every call.'
              : `${props.usage.callsWithoutInputUsage.toLocaleString()} calls missing input-token data.`}{' '}
            DSH-observed requests only; does not include outside DSH, calls before recording began, or TypeSafe account balance. Credential labels are local
            references, not provider-verified billing identity.
          </p>
        </div>
      )}
    </Panel>
  )
}
