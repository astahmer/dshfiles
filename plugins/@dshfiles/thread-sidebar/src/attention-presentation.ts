import type { AttentionColor, AttentionColors, AttentionColorKey } from './organization.js'

export type ThreadAttentionLabel = 'threadSidebarApprovalNeeded' | 'threadSidebarInputNeeded' | 'threadSidebarTurnFinished'

export interface ThreadStatusVisualInput {
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly attentionColors: AttentionColors
  readonly unread: boolean
  readonly running: boolean
}

const attentionColorKeys = {
  threadSidebarApprovalNeeded: 'approvalNeeded',
  threadSidebarInputNeeded: 'inputNeeded',
  threadSidebarTurnFinished: 'turnFinished',
} satisfies Record<ThreadAttentionLabel, AttentionColorKey>

const attentionTextClasses = {
  muted: 'dshx:text-muted-foreground',
  primary: 'dshx:text-primary',
  info: 'dshx:text-info',
  success: 'dshx:text-success',
  warning: 'dshx:text-warning',
  danger: 'dshx:text-destructive',
} satisfies Record<AttentionColor, string>

const attentionDotClasses = {
  muted: 'dshx:bg-muted-foreground/45',
  primary: 'dshx:bg-primary',
  info: 'dshx:bg-info',
  success: 'dshx:bg-success',
  warning: 'dshx:bg-warning',
  danger: 'dshx:bg-destructive',
} satisfies Record<AttentionColor, string>

export const attentionLabelClass = (label: ThreadAttentionLabel, attentionColors: AttentionColors): string =>
  `${attentionTextClasses[attentionColors[attentionColorKeys[label]]]}/80`

export const attentionDotClass = (input: ThreadStatusVisualInput): string => {
  if (input.attentionLabel !== undefined) return attentionDotClasses[input.attentionColors[attentionColorKeys[input.attentionLabel]]]
  if (input.unread) return 'dshx:bg-primary'
  if (input.running) return 'dshx:animate-pulse dshx:bg-info'
  return 'dshx:bg-muted-foreground/45'
}

export const attentionColorDotClass = (color: AttentionColor): string => attentionDotClasses[color]
