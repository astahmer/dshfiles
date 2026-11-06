import { SecretSetupSteps, type SecretSetupStep } from './secret-setup-step.js'

/**
 * Where one missing requirement stands in the offer: waiting for a click, showing its form, or bound. A cancelled
 * form keeps the reference it stored, so the row offers to retry its bind instead of creating another secret.
 */
export type SecretSetupRequirement =
  | { readonly kind: 'offered'; readonly createdReference: string | null }
  | { readonly kind: 'editing'; readonly step: SecretSetupStep }
  | { readonly kind: 'bound'; readonly reference: string }

/**
 * One requirement state per missing requirement, plus whether the offer's panel is open. The offer owns these, so a
 * form only renders the step it is given; closing the panel drops the drafts but keeps every stored reference.
 */
export interface SecretSetupOfferState {
  readonly panel: 'closed' | 'open'
  readonly requirements: Readonly<Record<string, SecretSetupRequirement>>
}

const withRequirement = (state: SecretSetupOfferState, id: string, requirement: SecretSetupRequirement): SecretSetupOfferState => ({
  ...state,
  requirements: { ...state.requirements, [id]: requirement },
})

const withoutRequirement = (state: SecretSetupOfferState, id: string): SecretSetupOfferState => {
  if (state.requirements[id] === undefined) return state
  const requirements = { ...state.requirements }
  delete requirements[id]
  return { ...state, requirements }
}

/** A closed panel keeps a form's stored reference as that requirement's retry, and nothing else. */
const release = (requirement: SecretSetupRequirement): SecretSetupRequirement => {
  if (requirement.kind !== 'editing') return requirement
  return { kind: 'offered', createdReference: SecretSetupSteps.createdReference(requirement.step) ?? null }
}

const stepOf = (requirement: SecretSetupRequirement): SecretSetupStep | undefined => (requirement.kind === 'editing' ? requirement.step : undefined)

export const SecretSetupOffer = {
  initial: (): SecretSetupOfferState => ({ panel: 'closed', requirements: {} }),

  open: (input: { readonly state: SecretSetupOfferState; readonly ids: readonly string[] }): SecretSetupOfferState => {
    const requirements: Record<string, SecretSetupRequirement> = { ...input.state.requirements }
    for (const id of input.ids) requirements[id] ??= { kind: 'offered', createdReference: null }
    return { panel: 'open', requirements }
  },

  close: (state: SecretSetupOfferState): SecretSetupOfferState => {
    if (SecretSetupOffer.busy(state)) return state
    return {
      panel: 'closed',
      requirements: Object.fromEntries(Object.entries(state.requirements).map(([id, requirement]) => [id, release(requirement)])),
    }
  },

  /** The resume / retry-bind row shows the form again: a stored reference resumes at its bind. */
  edit: (input: { readonly state: SecretSetupOfferState; readonly id: string }): SecretSetupOfferState => {
    const existing = input.state.requirements[input.id]
    if (existing?.kind === 'editing') return input.state
    const createdReference = existing?.kind === 'offered' ? existing.createdReference : null
    return withRequirement(input.state, input.id, { kind: 'editing', step: SecretSetupSteps.restore(createdReference ?? undefined) })
  },

  step: (input: { readonly state: SecretSetupOfferState; readonly id: string; readonly step: SecretSetupStep }): SecretSetupOfferState =>
    withRequirement(input.state, input.id, { kind: 'editing', step: input.step }),

  markBound: (input: { readonly state: SecretSetupOfferState; readonly id: string; readonly reference: string }): SecretSetupOfferState =>
    withRequirement(input.state, input.id, { kind: 'bound', reference: input.reference }),

  /** Abandoning a form returns its requirement to its row, keeping the reference it already stored. */
  cancel: (input: { readonly state: SecretSetupOfferState; readonly id: string }): SecretSetupOfferState => {
    const requirement = input.state.requirements[input.id]
    if (requirement === undefined) return input.state
    if (SecretSetupSteps.busy(stepOf(requirement) ?? SecretSetupSteps.draft())) return input.state
    return withRequirement(input.state, input.id, release(requirement))
  },

  /** Requirements that are no longer missing leave no state behind; the others keep theirs. */
  prune: (input: { readonly state: SecretSetupOfferState; readonly ids: readonly string[] }): SecretSetupOfferState => {
    const active = new Set(input.ids)
    const entries = Object.entries(input.state.requirements).filter(([id]) => active.has(id))
    if (entries.length === Object.keys(input.state.requirements).length) return input.state
    return { ...input.state, requirements: Object.fromEntries(entries) }
  },

  busy: (state: SecretSetupOfferState): boolean =>
    Object.values(state.requirements).some(requirement => {
      const step = stepOf(requirement)
      return step !== undefined && SecretSetupSteps.busy(step)
    }),

  /** Whether that requirement still shows its form (or its bound label) rather than its row. */
  editing: (state: SecretSetupOfferState, id: string): boolean => state.requirements[id]?.kind === 'editing',

  bound: (state: SecretSetupOfferState, id: string): boolean => state.requirements[id]?.kind === 'bound',

  createdReference: (state: SecretSetupOfferState, id: string): string | undefined => {
    const requirement = state.requirements[id]
    if (requirement === undefined) return undefined
    if (requirement.kind === 'offered') return requirement.createdReference ?? undefined
    if (requirement.kind === 'bound') return requirement.reference
    return SecretSetupSteps.createdReference(requirement.step)
  },
}
