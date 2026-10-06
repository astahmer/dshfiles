export interface ForkBoundary {
  readonly seq: number
  readonly eventType: string
}

export const durableForkBoundaries = (
  entries: readonly { readonly type: 'event' | 'transient'; readonly event: { readonly seq: number; readonly type: string } }[],
): ForkBoundary[] =>
  entries.flatMap(entry => (entry.type === 'event' ? [{ seq: entry.event.seq, eventType: entry.event.type }] : []))
