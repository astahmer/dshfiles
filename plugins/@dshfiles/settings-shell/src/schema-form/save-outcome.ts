/** One setting row's write outcome, keyed by the setting path: in flight, or refused by the Host. */
export type SaveOutcome<Edit> = { readonly status: 'saving'; readonly edit: Edit } | { readonly status: 'refused' }

export type SaveOutcomes<Edit> = ReadonlyMap<string, SaveOutcome<Edit>>

/** The in-flight entry for one write; its identity is what its settlement is matched against. */
export const savingOutcome = <Edit>(edit: Edit): SaveOutcome<Edit> => ({ status: 'saving', edit })

/** Settle one write: accepted clears the row, refused stays visible, and a write superseded meanwhile is ignored. */
export const settleSave = <Edit>(outcomes: SaveOutcomes<Edit>, key: string, outcome: SaveOutcome<Edit>, accepted: boolean): SaveOutcomes<Edit> => {
  if (outcomes.get(key) !== outcome) return outcomes
  const next = new Map(outcomes)
  if (accepted) next.delete(key)
  else next.set(key, { status: 'refused' })
  return next
}
