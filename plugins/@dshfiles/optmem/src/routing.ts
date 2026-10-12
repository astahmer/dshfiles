/**
 * Model matching shared by the Host route selection and the settings panel's validation. Browser-safe: no DSH runtime
 * imports, so the client bundle can check a route against the same rules the Host applies.
 */
export class SummaryRouting {
  /** The offered id for one candidate; a candidate ending in `*` matches every id with that prefix and takes the newest. */
  static offeredModel(candidate: string, offered: readonly string[]): string | undefined {
    const matches = (id: string, wanted: string): boolean => id === wanted || id.endsWith(`/${wanted}`)
    if (!candidate.endsWith('*')) return offered.find(id => matches(id, candidate))
    const prefix = candidate.slice(0, -1)
    const newestFirst = offered
      .filter(id => id.startsWith(prefix) || id.includes(`/${prefix}`))
      .toSorted((left, right) => right.localeCompare(left, 'en', { numeric: true }))
    return newestFirst[0]
  }

  /** The cheap-model entry for a provider: exact provider id, then its AI Accounts kind, then the longest id prefix. */
  static cheapEntryFor<Entry extends { readonly kind: string }>(
    entries: readonly Entry[],
    provider: string,
    accountKind: string | undefined,
  ): Entry | undefined {
    return (
      entries.find(entry => entry.kind === provider) ??
      (accountKind === undefined ? undefined : entries.find(entry => entry.kind === accountKind)) ??
      entries
        .filter(entry => provider.startsWith(`${entry.kind}-`) || provider.startsWith(`${entry.kind}_`))
        .toSorted((left, right) => right.kind.length - left.kind.length)[0]
    )
  }
}
