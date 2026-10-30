export const isWorkspaceMissing = (input: { readonly fetching: boolean; readonly found: boolean; readonly failed: boolean }): boolean =>
  !input.fetching && !input.failed && !input.found
