export const isWorkspaceMissing = (input: { readonly fetching: boolean; readonly found: boolean }): boolean =>
  !input.fetching && !input.found
