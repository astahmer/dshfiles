import type { CSSProperties } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AccountAccent } from './account-color.js'

/** An account's dot, in its light or dark value by the scheme (round 3 R9). */
export const AccountDot = ({ accent, className }: { readonly accent: AccountAccent; readonly className?: string }) => (
  <i
    aria-hidden="true"
    className={cn('dshx:shrink-0 dshx:rounded-full dshx:bg-(--account-dot) dshx:dark:bg-(--account-dot-dark)', className)}
    data-account-dot
    // SAFETY: custom properties are valid style keys; React's CSSProperties type does not list them.
    style={{ '--account-dot': accent.light, '--account-dot-dark': accent.dark } as CSSProperties}
  />
)
