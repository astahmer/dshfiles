import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { CheckIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import { BacklogItems, type BacklogAttention, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'

const triggerClass =
  'dshx:inline-flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'

/** A Linear-style property picker: the trigger is the current value, the menu lists every value with its glyph. */
const Picker = <Value extends string>(props: {
  readonly label: string
  readonly value: Value
  readonly values: readonly Value[]
  readonly render: (value: Value) => ReactNode
  readonly onPick: (value: Value) => void
  readonly trigger: ReactNode
  readonly triggerClassName?: string
}): JSX.Element => {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger aria-label={props.label} className={cn(triggerClass, props.triggerClassName)} onClick={event => event.stopPropagation()}>
        {props.trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="dshx-root dshx:min-w-44"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          const picked = props.values[Number(event.key) - 1]
          if (picked === undefined) return
          event.preventDefault()
          props.onPick(picked)
          setOpen(false)
        }}
      >
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{props.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {props.values.map((value, index) => (
          <DropdownMenuItem key={value} onSelect={() => props.onPick(value)} className="dshx:gap-2 dshx:text-[13px]">
            {props.render(value)}
            {value === props.value ? <CheckIcon aria-hidden className="dshx:ml-auto dshx:size-3.5" /> : null}
            {value === props.value ? null : <DropdownMenuShortcut>{index + 1}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const StatusPicker = (props: {
  readonly id: number
  readonly status: BacklogStatus
  readonly onPick: (status: BacklogStatus) => void
  readonly withLabel?: boolean
}): JSX.Element => (
  <Picker
    label={`Status of b:${String(props.id)}`}
    value={props.status}
    values={BacklogItems.statuses}
    onPick={props.onPick}
    triggerClassName={props.withLabel === true ? 'dshx:h-7 dshx:px-2 dshx:text-[13px]' : 'dshx:size-6 dshx:justify-center'}
    trigger={
      <>
        <ItemGlyphs.StatusIcon status={props.status} />
        {props.withLabel === true ? <span>{ItemGlyphs.statusLabels[props.status]}</span> : null}
      </>
    }
    render={status => (
      <>
        <ItemGlyphs.StatusIcon status={status} />
        {ItemGlyphs.statusLabels[status]}
      </>
    )}
  />
)

const KindPicker = (props: { readonly id: number; readonly kind: BacklogKind; readonly onPick: (kind: BacklogKind) => void }): JSX.Element => (
  <Picker
    label={`Kind of b:${String(props.id)}`}
    value={props.kind}
    values={BacklogItems.kinds}
    onPick={props.onPick}
    triggerClassName="dshx:h-7 dshx:px-2 dshx:text-[13px]"
    trigger={
      <>
        <ItemGlyphs.KindIcon kind={props.kind} />
        <span>{ItemGlyphs.kindLabels[props.kind]}</span>
      </>
    }
    render={kind => (
      <>
        <ItemGlyphs.KindIcon kind={kind} />
        {ItemGlyphs.kindLabels[kind]}
      </>
    )}
  />
)

const AttentionPicker = (props: {
  readonly id: number
  readonly attention: BacklogAttention
  readonly onPick: (attention: BacklogAttention) => void
}): JSX.Element => (
  <Picker
    label={`Attention of b:${String(props.id)}`}
    value={props.attention}
    values={BacklogItems.attentions}
    onPick={props.onPick}
    triggerClassName="dshx:h-7 dshx:px-1.5 dshx:text-[13px]"
    trigger={
      props.attention === 'none' ? <span className="dshx:text-muted-foreground">Attention</span> : <ItemGlyphs.AttentionBadge attention={props.attention} />
    }
    render={attention =>
      attention === 'none' ? <span className="dshx:text-muted-foreground">No attention</span> : <ItemGlyphs.AttentionBadge attention={attention} />
    }
  />
)

export class ItemPickers {
  static readonly Status = StatusPicker
  static readonly Kind = KindPicker
  static readonly Attention = AttentionPicker
}
