export const claudeCommand = (input: { readonly url: string; readonly token: string }): string =>
  `claude mcp add --transport http dsh ${input.url} --header "Authorization: Bearer ${input.token}"`
