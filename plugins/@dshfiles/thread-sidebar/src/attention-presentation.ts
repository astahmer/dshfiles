export type ThreadAttentionLabel = 'threadSidebarApprovalNeeded' | 'threadSidebarInputNeeded' | 'threadSidebarTurnFinished'

export interface ThreadStatusVisualInput {
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly unread: boolean
  readonly running: boolean
}

const attentionLabelClasses = {
  threadSidebarApprovalNeeded: 'dshx:text-warning/80',
  threadSidebarInputNeeded: 'dshx:text-info/80',
  threadSidebarTurnFinished: 'dshx:text-success/80',
} satisfies Record<ThreadAttentionLabel, string>

const attentionDotClasses = {
  threadSidebarApprovalNeeded: 'dshx:bg-warning',
  threadSidebarInputNeeded: 'dshx:bg-info',
  threadSidebarTurnFinished: 'dshx:bg-success',
} satisfies Record<ThreadAttentionLabel, string>

export const attentionLabelClass = (label: ThreadAttentionLabel): string => attentionLabelClasses[label]

export const attentionDotClass = (input: ThreadStatusVisualInput): string => {
  if (input.attentionLabel !== undefined) return attentionDotClasses[input.attentionLabel]
  if (input.unread) return 'dshx:bg-primary'
  if (input.running) return 'dshx:animate-pulse dshx:bg-info'
  return 'dshx:bg-muted-foreground/45'
}
