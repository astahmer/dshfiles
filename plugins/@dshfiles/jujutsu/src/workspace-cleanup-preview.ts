export const cleanupPreviewLoadingLabel = (input: { readonly isFetching: boolean; readonly hasData: boolean }): string | undefined => {
  if (!input.isFetching) return undefined
  return input.hasData ? 'Updating preview…' : 'Loading preview…'
}
