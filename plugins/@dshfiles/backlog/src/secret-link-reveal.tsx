import { defineContract, useContract } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface SecretLinkRevealProps {
  /** The item's link as written, `secret:ALIAS` or `secret:ALIAS@env`; never a value. */
  readonly reference: string
  /** The item's project, so project and machine-local aliases resolve; null reads global aliases only. */
  readonly cwd: string | null
}

/**
 * Reveals a `secret:` link inline in an item's relationships. The Secret Catalog owns the values and the reveal
 * policy (explicit click, timeout) and already depends on the backlog, so it provides the control here instead of the
 * backlog importing the Catalog, which would make the two bundles build each other.
 */
export const SecretLinkReveal = defineContract<{ readonly Reveal: ComponentType<SecretLinkRevealProps> }>('@dshfiles/backlog.secret-link-reveal', {
  owner: '@dshfiles/secret-catalog',
})

/** Renders nothing while the Secret Catalog is absent or disabled: the link stays a plain reference. */
export const SecretLinkRevealSlot = (props: SecretLinkRevealProps): JSX.Element | null => {
  const reveal = useContract(SecretLinkReveal)
  if (reveal.status !== 'active') return null
  return <reveal.value.Reveal {...props} />
}
