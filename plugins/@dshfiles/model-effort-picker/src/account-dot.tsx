import type { CSSProperties } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AccountAccent } from './account-color.js'

/** An account's dot, in its light or dark value by the scheme (round 3 R9). */
export const AccountDot = ({ accent, className }: { readonly accent: AccountAccent; readonly className?: string }) => {
  // The two values ride custom properties; the kit's dark variant picks one.
  const style: CSSProperties & Record<'--account-dot' | '--account-dot-dark', string> = { '--account-dot': accent.light, '--account-dot-dark': accent.dark }
  return (
    <i aria-hidden="true" className={cn('dshx:shrink-0 dshx:rounded-full dshx:bg-(--account-dot) dshx:dark:bg-(--account-dot-dark)', className)} data-account-dot style={style} />
  )
}
