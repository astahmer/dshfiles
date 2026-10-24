import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { TraceFormat } from './format.js'
import type { TracesTranslate } from './locales.js'
import { ServiceDot } from './trace-list.js'
import type { ModelUsage } from './types.js'

const numeric = 'dshx:text-right dshx:font-mono dshx:text-xs'
const tokenFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** Model calls per service and model over the window, with token sums and the list-price cost on their spans. */
export const ModelCostTable = (props: { readonly models: readonly ModelUsage[]; readonly t: TracesTranslate }): JSX.Element | null => {
  if (props.models.length === 0) return null
  const total = props.models.reduce<number | null>((sum, model) => (model.costUsd === null ? sum : (sum ?? 0) + model.costUsd), null)
  return (
    <section className="dshx:flex dshx:flex-col dshx:gap-1" aria-label={props.t('modelCosts')} data-testid="traces-model-costs">
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
        <h3 className="dshx:text-xs dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">{props.t('modelCosts')}</h3>
        <span className="dshx:font-mono dshx:text-xs" data-stat="modelCostTotal">
          {TraceFormat.usd(total)}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{props.t('model')}</TableHead>
            <TableHead className="dshx:w-16 dshx:text-right">{props.t('calls')}</TableHead>
            <TableHead className="dshx:w-28 dshx:text-right dshx:@max-pane-narrow:hidden">{props.t('statTokens')}</TableHead>
            <TableHead className="dshx:w-20 dshx:text-right">{props.t('cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.models.map(model => (
            <TableRow key={`${model.service}\u0000${model.provider ?? ''}\u0000${model.model}`}>
              <TableCell className="dshx:max-w-0">
                <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  <ServiceDot service={model.service} />
                  <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{model.service}</span>
                  <span className="dshx:min-w-0 dshx:truncate">{model.model}</span>
                  {model.provider === null ? null : (
                    <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden">{model.provider}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className={numeric}>{model.calls}</TableCell>
              <TableCell className={`${numeric} dshx:@max-pane-narrow:hidden`}>
                {tokenFormat.format(model.inputTokens)} · {tokenFormat.format(model.outputTokens)}
              </TableCell>
              <TableCell className={numeric}>{TraceFormat.usd(model.costUsd)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
