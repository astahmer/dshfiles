import { LEADING_GLYPH_ATTRIBUTE } from '@dshfiles/plugin-ui/components/selection'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ProviderGlyph as ProviderLogo } from './provider-glyph.js'
import { KIND_ACCENT } from './account-labels.js'
import type { AccountProfile } from './api.js'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, type ReactNode } from 'react'

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

export const ActionHint = (props: { readonly label: string; readonly children: JSX.Element }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="dshx:inline-flex">{props.children}</span>
    </TooltipTrigger>
    <TooltipContent>{props.label}</TooltipContent>
  </Tooltip>
)

/** Branded marks match the account rail/header, independently of editable picker tags: each provider keeps its colour. */
export const ProviderGlyph = (props: { readonly kind: AccountProfile['kind']; readonly large?: boolean; readonly list?: boolean }): JSX.Element => (
  <span
    aria-hidden
    // A list row leads with this mark, so its selection shows no marker pill beside it (council round 11, A1).
    {...(props.list === true ? LEADING_GLYPH_ATTRIBUTE : undefined)}
    className={cn(
      'dshx:grid dshx:shrink-0 dshx:place-items-center dshx:rounded-lg dshx:bg-foreground dshx:text-background dshx:shadow-sm',
      // A list row's mark is 28 px, the detail header's 32 (council round 5, D2).
      props.large ? 'dshx:size-16' : props.list === true ? 'dshx:size-7' : 'dshx:size-8',
      props.kind === 'opencode-go' && 'dshx:bg-violet dshx:text-primary-foreground',
    )}
    style={
      props.kind === 'claude' || props.kind === 'commandcode' || props.kind === 'mistral' || props.kind === 'antigravity' || props.kind === 'vibe'
        ? { backgroundColor: KIND_ACCENT[props.kind], color: 'white' }
        : undefined
    }
  >
    <ProviderLogo kind={props.kind} monochrome className={props.large ? 'dshx:size-10' : props.list === true ? 'dshx:size-4.5' : 'dshx:size-5'} />
  </span>
)

/** A settings or usage section; numbering is optional for older callers. */
export const NumberedSection = (props: {
  readonly index?: string
  readonly heading: string
  readonly description?: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}): JSX.Element => (
  <section className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-2 dshx:border-b dshx:py-3 dshx:last:border-b-0">
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2.5">
        {props.index === undefined ? null : <span className="dshx:font-mono dshx:text-xs dshx:text-info">{props.index}</span>}
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

/** One quota window: label, percent left in its tone, and the bar. */
