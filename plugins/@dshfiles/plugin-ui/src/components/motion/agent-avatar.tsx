import * as React from 'react'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'

/** Hues an agent, model or provider can wear. Semantic tokens only, so both themes work. */
export type AgentTone = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'violet' | 'teal' | 'muted'

/** Soft tile: tinted background with the hue as text. */
export const agentToneSoft = {
  'chart-1': 'dshx:bg-chart-1/15 dshx:text-chart-1',
  'chart-2': 'dshx:bg-chart-2/15 dshx:text-chart-2',
  'chart-3': 'dshx:bg-chart-3/15 dshx:text-chart-3',
  'chart-4': 'dshx:bg-chart-4/15 dshx:text-chart-4',
  'chart-5': 'dshx:bg-chart-5/15 dshx:text-chart-5',
  violet: 'dshx:bg-violet/15 dshx:text-violet',
  teal: 'dshx:bg-teal/15 dshx:text-teal',
  muted: 'dshx:bg-muted dshx:text-muted-foreground',
} as const satisfies Record<AgentTone, string>

/** Solid fill in the hue (tiny squares, bars, dots). */
export const agentToneSolid = {
  'chart-1': 'dshx:bg-chart-1',
  'chart-2': 'dshx:bg-chart-2',
  'chart-3': 'dshx:bg-chart-3',
  'chart-4': 'dshx:bg-chart-4',
  'chart-5': 'dshx:bg-chart-5',
  violet: 'dshx:bg-violet',
  teal: 'dshx:bg-teal',
  muted: 'dshx:bg-muted-foreground',
} as const satisfies Record<AgentTone, string>

/** Coloured glow under floating labels (cursors, toasts). */
export const agentToneGlow = {
  'chart-1': 'dshx:shadow-lg dshx:shadow-chart-1/40',
  'chart-2': 'dshx:shadow-lg dshx:shadow-chart-2/40',
  'chart-3': 'dshx:shadow-lg dshx:shadow-chart-3/40',
  'chart-4': 'dshx:shadow-lg dshx:shadow-chart-4/40',
  'chart-5': 'dshx:shadow-lg dshx:shadow-chart-5/40',
  violet: 'dshx:shadow-lg dshx:shadow-violet/40',
  teal: 'dshx:shadow-lg dshx:shadow-teal/40',
  muted: 'dshx:shadow-lg dshx:shadow-muted-foreground/40',
} as const satisfies Record<AgentTone, string>

export interface AgentAvatarProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Accessible name, and the letter shown when there is no icon. */
  readonly name: string
  readonly tone?: AgentTone
  /** A lucide icon instead of the letter (no brand logos). */
  readonly icon?: LucideIcon
  readonly size?: 'xs' | 'sm' | 'md'
  /** Round instead of a rounded square (presence stacks). */
  readonly round?: boolean
  /** Hide from assistive tech when a visible name sits next to it. */
  readonly decorative?: boolean
}

/** Letter or icon tile for an agent, model or integration. Brand-free by design. */
export const AgentAvatar = React.forwardRef<HTMLSpanElement, AgentAvatarProps>(function AgentAvatar(
  { name, tone = 'muted', icon: Icon, size = 'sm', round = false, decorative = false, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:font-semibold dshx:leading-none dshx:select-none',
        round ? 'dshx:rounded-full' : 'dshx:rounded-md',
        size === 'xs' && 'dshx:size-4 dshx:text-[9px] dshx:[&_svg]:size-2.5',
        size === 'sm' && 'dshx:size-6 dshx:text-[11px] dshx:[&_svg]:size-3.5',
        size === 'md' && 'dshx:size-8 dshx:text-xs dshx:[&_svg]:size-4',
        agentToneSoft[tone],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon /> : name.trim().charAt(0).toUpperCase()}
    </span>
  )
})
