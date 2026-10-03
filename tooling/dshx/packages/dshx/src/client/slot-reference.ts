/**
 * Which package declares which Client slot, and what a plugin needs to fill one.
 *
 * A slot's declaration lives in the package that owns it, so a plugin cannot see
 * `sidebar.panellist` in its own typed union until it imports that owner. That is
 * invisible from the plugin side — it looks like the slot does not exist — and it
 * is the single most confusing thing about authoring a Client entry, because the
 * fix is a type-only import of a package whose name is nowhere in the error.
 *
 * This table is that knowledge in one place, for `dshx inspect slots --explain`
 * and for `dshx add ui --slot`, both of which can then write the imports instead
 * of leaving them to be remembered.
 */

export interface ClientSlotReference {
  /** The slot name as the owner declares it. */
  readonly name: string
  /** Package whose types declare the slot; import it type-only to widen the union. */
  readonly declaredBy: readonly string[]
  /** What the owner hands the occupant, beyond the standard slot props. */
  readonly ownerProps?: string
  readonly purpose: string
  /**
   * Whether registering the same id replaces the shipped occupant instead of
   * joining it. A plugin that gets this wrong renders a second copy of a surface
   * the Host already owns.
   */
  readonly replaces: readonly string[]
}

export const CLIENT_SLOT_REFERENCES: readonly ClientSlotReference[] = [
  {
    name: 'sidebar.panellist',
    declaredBy: ['@deepseek-ai/dsh-client-ui-sidebar/client'],
    ownerProps: 'row metadata projected by the sidebar',
    purpose: 'Global sidebar rows. Plugins occupies order 0, so a row below it uses order 1 or more.',
    replaces: [],
  },
  {
    name: 'main',
    declaredBy: ['@deepseek-ai/dsh-client-ui-layout/client'],
    purpose: 'The main panel body, addressed by key. A panel registers here and a sidebar row selects it.',
    replaces: [],
  },
  {
    name: 'sidebar.footer.action',
    declaredBy: ['@deepseek-ai/dsh-client-ui-sidebar/client'],
    ownerProps: 'wide: boolean',
    purpose: 'Actions beside Settings at the sidebar foot. Receives only the column state, so it cannot navigate.',
    replaces: ['cordis-panel', 'commandcode-panel'],
  },
  {
    name: 'sidebar.brandmark',
    declaredBy: ['@deepseek-ai/dsh-client-ui-sidebar/client'],
    ownerProps: 'requested square edge in pixels',
    purpose: 'The sidebar brand mark.',
    replaces: [],
  },
  {
    name: 'conversation.input.dock',
    declaredBy: ['@deepseek-ai/dsh-client-ui-conversation/client'],
    purpose: 'The composer dock. The shipped queue occupant is id "queue" at order 20.',
    replaces: ['queue'],
  },
  {
    name: 'settings.section',
    declaredBy: ['@deepseek-ai/dsh-client-ui-settings/client'],
    purpose: 'A section in the settings dialog. Distinct from a main panel, which lives in the sidebar.',
    replaces: [],
  },
  {
    name: 'settings.launcher',
    declaredBy: ['@deepseek-ai/dsh-client-ui-settings/client'],
    purpose: 'The settings launcher control.',
    replaces: [],
  },
]

/** Look up one slot, or `undefined` when the name is not a known Client slot. */
export const findClientSlot = (name: string): ClientSlotReference | undefined =>
  CLIENT_SLOT_REFERENCES.find(slot => slot.name === name)

/**
 * Type-only imports a plugin needs before this slot name typechecks.
 *
 * Returns them already formatted, so both the explanation and the generated
 * source come from one source of truth and cannot disagree.
 */
export const slotOwnerImports = (name: string): readonly string[] =>
  findClientSlot(name)?.declaredBy ?? []