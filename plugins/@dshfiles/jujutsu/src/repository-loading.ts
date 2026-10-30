export const repositoryLoadingState = (input: {
  readonly registering: boolean
  readonly fetching: boolean
  readonly hasState: boolean
  readonly hasError: boolean
}) => {
  const loading = input.registering || input.fetching
  return { loading, showEmptyPrompt: !input.hasState && !loading && !input.hasError, showLoadFailure: !input.hasState && !loading && input.hasError }
}

export const shouldReregisterRepository = (input: {
  readonly hasError: boolean
  readonly repoId: string | null
  readonly path: string
  readonly recoveredPath: string | null
}): boolean => input.hasError && input.repoId !== null && input.path.trim().length > 0 && input.recoveredPath !== input.path
