/**
 * Protocol-2 Client slot facts checked against the installed 0.2.0-rc.2
 * declarations. Runtime inspect owns active occupants and child composition;
 * this offline catalog only states declaration-level facts.
 */
export interface ClientSlotReference {
  readonly name: string
  /** Package whose types declare the slot; import it type-only to widen the union. */
  readonly declaredBy: readonly string[]
  readonly kind: 'single' | 'list' | 'keyed' | 'chain'
  readonly scope: 'root' | 'session' | 'session-maybe'
  /** Registration identity when the native contract assigns one. */
  readonly identity?: 'id' | 'key'
  readonly registration: readonly string[]
  readonly registrationMetadata?: readonly string[]
  /** Owner props projected by this SlotMap declaration. */
  readonly ownerProps?: readonly string[]
  readonly purpose: string
  /** Known occupants in the shipped composition, not a claim about the live profile. */
  readonly shippedOccupants: readonly string[]
  /** Reusing these identities replaces an existing shipped entry. */
  readonly replaces: readonly string[]
  /** Required composition children when replacing a shell that declares Slots. */
  readonly childObligations: readonly string[]
  readonly declaration: string
}

const SIDEBAR = '@deepseek-ai/dsh-client-ui-sidebar/client'
const LAYOUT = '@deepseek-ai/dsh-client-ui-layout/client'
const CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation/client'
const SETTINGS = '@deepseek-ai/dsh-client-ui-settings/client'

export const CLIENT_SLOT_REFERENCES: readonly ClientSlotReference[] = [
  {
    name: 'sidebar',
    declaredBy: [LAYOUT],
    kind: 'single',
    scope: 'root',
    registration: [],
    ownerProps: ['collapsed: boolean', 'width: number'],
    purpose: 'The entire left navigation column. Replacing it also removes the inner sidebar Seats declared by the shipped sidebar shell.',
    shippedOccupants: ['ui-sidebar'],
    replaces: ['ui-sidebar'],
    childObligations: [
      'Render the compact control rail while collapsed.',
      'Provide sidebar.brand.mark, sidebar.brand.name, sidebar.panellist, sidebar.workspaces, sidebar.settings, and sidebar.footer.action if those affordances are needed.',
    ],
    declaration: `${LAYOUT}#SlotMap.sidebar`,
  },
  {
    name: 'sidebar.panellist',
    declaredBy: [SIDEBAR],
    kind: 'list',
    scope: 'root',
    identity: 'id',
    registration: ['id', 'order', 'label'],
    ownerProps: ['size: number', 'active: boolean'],
    purpose: 'Global panel icons. Each id must match the key registered in main; order is ascending and ties retain registration order.',
    shippedOccupants: ['plugins'],
    replaces: ['plugins'],
    childObligations: [],
    declaration: `${SIDEBAR}#SlotMap.sidebar.panellist`,
  },
  {
    name: 'main',
    declaredBy: [LAYOUT],
    kind: 'keyed',
    scope: 'root',
    identity: 'key',
    registration: ['key'],
    purpose:
      'Root panel body selected by its key. Only the reserved conversation key receives Conversation binding; pair other keys with sidebar.panellist entries for navigation.',
    shippedOccupants: ['conversation'],
    replaces: ['conversation'],
    childObligations: [],
    declaration: `${LAYOUT}#SlotMap.main`,
  },
  {
    name: 'sidebar.footer.action',
    declaredBy: [SIDEBAR],
    kind: 'list',
    scope: 'root',
    identity: 'id',
    registration: ['id', 'order'],
    ownerProps: ['wide: boolean'],
    purpose: 'Actions beside Settings at the sidebar foot. Receives the sidebar width state and cannot navigate through owner props alone.',
    shippedOccupants: ['cordis-panel', 'commandcode-panel'],
    replaces: ['cordis-panel', 'commandcode-panel'],
    childObligations: [],
    declaration: `${SIDEBAR}#SlotMap.sidebar.footer.action`,
  },
  {
    name: 'sidebar.brand.mark',
    declaredBy: [SIDEBAR],
    kind: 'single',
    scope: 'root',
    registration: [],
    ownerProps: ['size: number'],
    purpose: 'Brand mark rendered in the expanded row and collapsed rail.',
    shippedOccupants: [],
    replaces: [],
    childObligations: [],
    declaration: `${SIDEBAR}#SlotMap.sidebar.brand.mark`,
  },
  {
    name: 'conversation.input.dock',
    declaredBy: [CONVERSATION],
    kind: 'list',
    scope: 'session',
    identity: 'id',
    registration: ['id', 'order'],
    ownerProps: ['session: SessionSnapshot', 'input: InputState'],
    purpose: 'Full-width entries above the composer card. Its owner values exist only for a Session-scoped composer.',
    shippedOccupants: ['todo', 'queue'],
    replaces: ['todo', 'queue'],
    childObligations: [],
    declaration: `${CONVERSATION}#SlotMap.conversation.input.dock`,
  },
  {
    name: 'settings.section',
    declaredBy: [SETTINGS],
    kind: 'list',
    scope: 'root',
    identity: 'id',
    registration: ['id', 'order', 'label'],
    registrationMetadata: ['settingsTargets?: readonly string[]'],
    ownerProps: ['close: () => void', 'openSection(id)', 'openSettingsTarget(target)', 'target?', 'acknowledgeTarget(requestId)'],
    purpose: 'A settings dialog section. Advertise handled ConfigForm entry ids in settingsTargets; the Host routes matching field targets here.',
    shippedOccupants: [],
    replaces: [],
    childObligations: [],
    declaration: `${SETTINGS}#SlotMap.settings.section`,
  },
  {
    name: 'settings.launcher',
    declaredBy: [SETTINGS],
    kind: 'single',
    scope: 'root',
    registration: [],
    ownerProps: ['wide: boolean', 'settingsOpen: boolean', 'settingsShortcut?', 'openSettings()', 'openSection(id)', 'openOnboarding(id)'],
    purpose: 'A sidebar account launcher that opens the shell-owned settings panel with Host-owned section navigation.',
    shippedOccupants: [],
    replaces: [],
    childObligations: [],
    declaration: `${SETTINGS}#SlotMap.settings.launcher`,
  },
]

/** Look up one slot, or `undefined` when the name is not a known Client slot. */
export const findClientSlot = (name: string): ClientSlotReference | undefined => CLIENT_SLOT_REFERENCES.find(slot => slot.name === name)

/** Type-only imports a plugin needs before this slot name typechecks. */
export const slotOwnerImports = (name: string): readonly string[] => findClientSlot(name)?.declaredBy ?? []
