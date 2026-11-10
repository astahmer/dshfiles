/**
 * Where one create-and-bind form stands: the draft, the create call, the stored reference and the bind call it runs
 * after. A stored secret outlives a failed bind, so a retry binds the same reference instead of creating another.
 */
export type SecretSetupStep =
  | { readonly kind: 'draft'; readonly error: 'load' | 'folder' | 'create' | 'bind' | null }
  | { readonly kind: 'creating' }
  | { readonly kind: 'created'; readonly reference: string; readonly error: 'bind' | null }
  | { readonly kind: 'binding'; readonly reference: string; readonly origin: 'created' | 'existing' }
  | { readonly kind: 'bound'; readonly reference: string }

const draft = (error: 'load' | 'folder' | 'create' | 'bind' | null = null): SecretSetupStep => ({ kind: 'draft', error })

export const SecretSetupSteps = {
  draft: (): SecretSetupStep => draft(null),

  /** A form reopened on an already stored reference resumes at the bind it still has to do. */
  restore: (createdReference: string | undefined): SecretSetupStep =>
    createdReference === undefined ? draft() : { kind: 'created', reference: createdReference, error: null },

  busy: (step: SecretSetupStep): boolean => step.kind === 'creating' || step.kind === 'binding',

  /** The stored reference the form keeps while it is only waiting to bind it. */
  createdReference: (step: SecretSetupStep): string | undefined => {
    if (step.kind === 'created' || step.kind === 'bound') return step.reference
    if (step.kind === 'binding' && step.origin === 'created') return step.reference
    return undefined
  },

  startCreate: (step: SecretSetupStep): SecretSetupStep => (step.kind === 'draft' ? { kind: 'creating' } : step),

  /** A duplicate detected on the failed create's re-listing is not an error: the user picks the existing secret. */
  createFailed: (input: { readonly step: SecretSetupStep; readonly error: 'load' | 'folder' | 'create' | null }): SecretSetupStep =>
    input.step.kind === 'draft' || input.step.kind === 'creating' ? draft(input.error) : input.step,

  createSettled: (input: { readonly reference: string; readonly bound: boolean }): SecretSetupStep =>
    input.bound ? { kind: 'bound', reference: input.reference } : { kind: 'created', reference: input.reference, error: 'bind' },

  startBind: (input: { readonly step: SecretSetupStep; readonly reference: string; readonly origin: 'created' | 'existing' }): SecretSetupStep => ({
    kind: 'binding',
    reference: input.reference,
    origin: input.origin,
  }),

  bindSettled: (input: { readonly step: SecretSetupStep; readonly bound: boolean }): SecretSetupStep => {
    if (input.step.kind !== 'binding') return input.step
    if (input.bound) return { kind: 'bound', reference: input.step.reference }
    if (input.step.origin === 'created') return { kind: 'created', reference: input.step.reference, error: 'bind' }
    return draft('bind')
  },
}
