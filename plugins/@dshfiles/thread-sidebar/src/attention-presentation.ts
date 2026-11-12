import type { AttentionColor, AttentionColors, AttentionColorKey } from './organization.js'

export type ThreadAttentionLabel =
  | 'threadSidebarApprovalNeeded'
  | 'threadSidebarInputNeeded'
  | 'threadSidebarTurnFinished'
  | 'threadSidebarNeedsResume'
  | 'threadSidebarInterrupted'

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
} satisfies Record<Exclude<ThreadAttentionLabel, 'threadSidebarNeedsResume' | 'threadSidebarInterrupted'>, AttentionColorKey>

/**
 * The recovery labels describe a Host fact, not a user preference, so they keep fixed colors: a resume waits on you
 * (the indigo Needs you hue), an interrupted turn failed (red). Colour is a signal (visual refresh P1).
 */
const attentionColorForLabel = (label: ThreadAttentionLabel, attentionColors: AttentionColors): AttentionColor => {
  if (label === 'threadSidebarNeedsResume') return 'info'
  if (label === 'threadSidebarInterrupted') return 'danger'
  return attentionColors[attentionColorKeys[label]]
}

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

const attentionLabelClass = (label: ThreadAttentionLabel, attentionColors: AttentionColors): string =>
  `${attentionTextClasses[attentionColorForLabel(label, attentionColors)]}/80`

const attentionDotClass = (input: ThreadStatusVisualInput): string => {
  if (input.attentionLabel !== undefined) return attentionDotClasses[attentionColorForLabel(input.attentionLabel, input.attentionColors)]
  if (input.unread) return 'dshx:bg-primary'
  // Working is colourless (the status vocabulary): only Needs you and Failed carry a hue.
  if (input.running) return 'dshx:animate-pulse dshx:bg-muted-foreground'
  return 'dshx:bg-muted-foreground/45'
}

const attentionColorDotClass = (color: AttentionColor): string => attentionDotClasses[color]

export class ThreadAttentionPresentationModel {
  static readonly attentionLabelClass = attentionLabelClass
  static readonly attentionDotClass = attentionDotClass
  static readonly attentionColorDotClass = attentionColorDotClass
}
