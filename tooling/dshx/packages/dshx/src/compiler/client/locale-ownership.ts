/**
 * Locale namespace ownership.
 *
 * The client Locale runtime keeps exactly one dictionary per
 * `(namespace, locale)` pair for the whole browser session, so a namespace is a
 * process-wide singleton rather than a per-package name. Two packages that
 * register the same namespace and the same locale id cannot both load; the
 * runtime throws on the second registration, which surfaces as a Web UI
 * "Failed to load plugins" card naming an entry that has nothing to do with the
 * plugin that actually broke.
 *
 * Catching that at build time needs to know who *else* is installed, which is a
 * property of a profile rather than of a single package. Shipped namespaces are
 * therefore always reserved, while a sibling plugin only conflicts when a profile
 * installs both.
 */

/** Namespaces registered by shipped packages. No profile may reassign these. */
const RESERVED_LOCALE_NAMESPACES = {
  '@deepseek-ai/dsh-client-ui-conversation': ['conversation'],
  '@deepseek-ai/dsh-client-ui-settings': ['settings'],
} satisfies Readonly<Record<string, readonly string[]>>

/** A namespace claim blocked by another package that already owns it. */
export interface LocaleNamespaceConflict {
  readonly namespace: string
  /** Package that already registers the namespace. */
  readonly owner: string
  /** True when the owner is a shipped package, so no profile may reassign it. */
  readonly reserved: boolean
}

export interface LocaleNamespaceOwnership {
  /** Package being built; it never conflicts with itself. */
  readonly packageId: string
  /** Namespace to owning package. */
  readonly owners: Map<string, string>
}

const buildLocaleNamespaceOwnership = (packageId: string): LocaleNamespaceOwnership => {
  const owners = new Map<string, string>()
  for (const [owner, namespaces] of Object.entries(RESERVED_LOCALE_NAMESPACES)) {
    for (const namespace of namespaces) owners.set(namespace, owner)
  }
  return { packageId, owners }
}

/**
 * Credit a package installed in the same profile with the namespaces it claims.
 * A shipped owner is never overwritten, so a sibling cannot shadow a platform
 * namespace.
 */
const claimLocaleNamespaces = (ownership: LocaleNamespaceOwnership, packageId: string, namespaces: readonly string[]): void => {
  if (packageId === ownership.packageId) return
  for (const namespace of namespaces) {
    if (ownership.owners.has(namespace)) continue
    ownership.owners.set(namespace, packageId)
  }
}

/** First owner that blocks a claim, or undefined when every namespace is free. */
const findLocaleNamespaceConflict = (ownership: LocaleNamespaceOwnership, claimed: readonly string[]): LocaleNamespaceConflict | undefined => {
  for (const namespace of claimed) {
    const owner = ownership.owners.get(namespace)
    if (owner === undefined || owner === ownership.packageId) continue
    return { namespace, owner, reserved: Object.hasOwn(RESERVED_LOCALE_NAMESPACES, owner) }
  }
  return undefined
}

export class LocaleNamespaceOwnershipModel {
  static readonly reservedNamespaces = RESERVED_LOCALE_NAMESPACES
  static readonly build = buildLocaleNamespaceOwnership
  static readonly claim = claimLocaleNamespaces
  static readonly findConflict = findLocaleNamespaceConflict
}
