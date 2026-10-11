export const repositoryLoadingState = (input: { readonly registering: boolean; readonly fetching: boolean; readonly hasState: boolean }) => {
  const loading = input.registering || input.fetching
  return { loading, showEmptyPrompt: !input.hasState && !loading }
}
