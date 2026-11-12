/**
 * A linked pull request or issue reads its state from its glyph and word in neutral ink (DESIGN.md: colour only for
 * Needs you and Failed). Failing checks are the one failure here, so they alone are red.
 */
export const pullStateTones = {
  open: 'dshx:text-muted-foreground',
  merged: 'dshx:text-muted-foreground',
  closed: 'dshx:text-muted-foreground',
  unknown: 'dshx:text-muted-foreground',
} as const
export const checkTones = {
  passing: 'dshx:text-muted-foreground',
  failing: 'dshx:text-destructive',
  pending: 'dshx:text-muted-foreground',
  none: 'dshx:text-muted-foreground',
} as const
export const issueStateTones = { open: 'dshx:text-muted-foreground', closed: 'dshx:text-muted-foreground', unknown: 'dshx:text-muted-foreground' } as const
