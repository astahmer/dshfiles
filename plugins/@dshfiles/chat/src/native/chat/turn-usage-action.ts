/**
 * dshfiles (unslop T21): whether a Turn's usage earns its entry among the reply actions. "Usage 0 tok" is a statistic
 * that says nothing and opens a dialog of zeros (a failed request, a provider that reports no usage).
 * @param usage - the Turn's token usage, when the Host recorded one.
 * @returns whether to offer the usage action.
 */
export function showsTurnUsage(usage: { readonly totalTokens: number } | undefined): boolean {
  return usage !== undefined && usage.totalTokens > 0
}
