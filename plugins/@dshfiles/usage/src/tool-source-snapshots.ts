import type { ToolSourceMetadata } from './fold.js'

export const toolSourceSnapshotsEqual = ({
  previous,
  next,
}: {
  readonly previous: ReadonlyMap<string, ToolSourceMetadata> | undefined
  readonly next: ReadonlyMap<string, ToolSourceMetadata>
}): boolean => {
  if (previous === undefined || previous.size !== next.size) return false
  for (const [name, metadata] of next) {
    const prior = previous.get(name)
    if (prior === undefined || prior.source !== metadata.source || prior.owner !== metadata.owner) return false
  }
  return true
}
