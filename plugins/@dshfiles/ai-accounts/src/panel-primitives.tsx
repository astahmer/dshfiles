import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, type ReactNode } from 'react'
import { QUOTA_TONE_PROGRESS, QUOTA_TONE_TEXT, quotaTone } from './quota-tone.js'

/** Kit `Field` drops its vertical layout (unprefixed classes), so the column is restated here. */
export const LabelledControl = (props: { readonly label: string; readonly hint?: string; readonly children: (id: string) => JSX.Element }): JSX.Element => {
  const id = useId()
  return (
    <Field className="dshx:flex-col dshx:gap-1.5">
      <FieldLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={id}>
        {props.label}
      </FieldLabel>
      {props.children(id)}
      {props.hint === undefined ? null : <FieldDescription className="dshx:text-xs">{props.hint}</FieldDescription>}
    </Field>
  )
}

/** One numbered section, the shape the reference page numbers 01–05. */
export const NumberedSection = (props: {
  readonly index: string
  readonly heading: string
  readonly description?: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}): JSX.Element => (
  <section className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-2 dshx:border-b dshx:py-3 dshx:last:border-b-0">
    <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
      <div className="dshx:flex dshx:items-center dshx:gap-2.5">
        <span className="dshx:font-mono dshx:text-xs dshx:text-info">{props.index}</span>
        <h3 className="dshx:text-sm dshx:font-semibold">{props.heading}</h3>
      </div>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        {props.description === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{props.description}</span>}
        {props.actions}
      </div>
    </div>
    {props.children}
  </section>
)

/** The coloured square a profile wears in the rail, the detail header and the model picker. */
export const ProviderMark = (props: { readonly badge: string; readonly color: string; readonly size?: 'default' | 'lg' }): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'dshx:grid dshx:shrink-0 dshx:place-items-center dshx:rounded-md dshx:bg-muted-foreground dshx:font-bold dshx:text-white dshx:ring-1 dshx:ring-white/15 dshx:ring-inset',
      props.size === 'lg' ? 'dshx:size-9 dshx:text-sm' : 'dshx:size-6 dshx:text-[10px]',
    )}
    style={{ background: props.color === '' ? undefined : props.color }}
  >
    {props.badge}
  </span>
)

/** One quota window: label, percent left in its tone, and the bar. */
export const QuotaMeter = (props: {
  readonly label: string
  readonly percent: number
  readonly detail?: string | null
  readonly className?: string
}): JSX.Element => {
  const tone = quotaTone(props.percent)
  return (
    <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1.5', props.className)}>
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2">
        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{props.label}</span>
        <span className={cn('dshx:text-sm dshx:font-semibold dshx:tabular-nums', QUOTA_TONE_TEXT[tone])}>{props.percent}% left</span>
      </div>
      <Progress
        aria-label={`${props.label} remaining`}
        className={cn('dshx:h-1.5 dshx:bg-muted', QUOTA_TONE_PROGRESS[tone])}
        value={Math.max(0, Math.min(100, props.percent))}
      />
      {props.detail === undefined || props.detail === null ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{props.detail}</span>}
    </div>
  )
}
