import type { WorkspaceProcessView } from '@dshfiles/jj-integration/api'

export const cleanupPreviewLoadingLabel = (input: { readonly isFetching: boolean; readonly hasData: boolean }): string | undefined => {
  if (!input.isFetching) return undefined
  return input.hasData ? 'Updating preview…' : 'Loading preview…'
}

/** What a removal does to the processes still running in the workspace: the ones it stops, then the terminals it keeps. */
export const cleanupProcessLabels = (processes: readonly WorkspaceProcessView[] | undefined): readonly string[] => {
  const names = (kept: boolean) => (processes ?? []).filter(entry => (entry.outcome === 'kept-terminal') === kept).map(entry => entry.command)
  const stops = names(false)
  const keeps = names(true)
  return [...(stops.length === 0 ? [] : [`Stops ${stops.join(', ')}`]), ...(keeps.length === 0 ? [] : [`Keeps terminal ${keeps.join(', ')}`])]
}
