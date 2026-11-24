import * as React from 'react'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'

/**
 * Hues an agent, model or provider can wear. The keys are the historical names; each draws an identity tone
 * (DESIGN.md › Colour roles 5), never a status hue, so an agent can never read as Failed or Ready.
 */
export type AgentTone = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'violet' | 'teal' | 'muted'

/** Soft tile: tinted background with the hue as text. */
export const agentToneSoft = {
  'chart-1': 'dshx:bg-identity-7/15 dshx:text-identity-7',
  'chart-2': 'dshx:bg-identity-5/15 dshx:text-identity-5',
  'chart-3': 'dshx:bg-identity-3/15 dshx:text-identity-3',
  'chart-4': 'dshx:bg-identity-4/15 dshx:text-identity-4',
  'chart-5': 'dshx:bg-identity-6/15 dshx:text-identity-6',
  violet: 'dshx:bg-identity-2/15 dshx:text-identity-2',
  teal: 'dshx:bg-identity-1/15 dshx:text-identity-1',
  muted: 'dshx:bg-muted dshx:text-muted-foreground',
} as const satisfies Record<AgentTone, string>

/** Solid fill in the hue (tiny squares, bars, dots). */
export const agentToneSolid = {
  'chart-1': 'dshx:bg-identity-7',
  'chart-2': 'dshx:bg-identity-5',
  'chart-3': 'dshx:bg-identity-3',
  'chart-4': 'dshx:bg-identity-4',
  'chart-5': 'dshx:bg-identity-6',
  violet: 'dshx:bg-identity-2',
  teal: 'dshx:bg-identity-1',
  muted: 'dshx:bg-muted-foreground',
} as const satisfies Record<AgentTone, string>

/** Coloured glow under floating labels (cursors, toasts). */
export const agentToneGlow = {
  'chart-1': 'dshx:shadow-lg dshx:shadow-identity-7/40',
  'chart-2': 'dshx:shadow-lg dshx:shadow-identity-5/40',
  'chart-3': 'dshx:shadow-lg dshx:shadow-identity-3/40',
  'chart-4': 'dshx:shadow-lg dshx:shadow-identity-4/40',
  'chart-5': 'dshx:shadow-lg dshx:shadow-identity-6/40',
  violet: 'dshx:shadow-lg dshx:shadow-identity-2/40',
  teal: 'dshx:shadow-lg dshx:shadow-identity-1/40',
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
        size === 'xs' && 'dshx:size-4 dshx:text-2xs dshx:[&_svg]:size-2.5',
        size === 'sm' && 'dshx:size-6 dshx:text-2xs dshx:[&_svg]:size-3.5',
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
