import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArrowRightIcon, KeyRoundIcon } from '@dshfiles/plugin-ui/icons'
import { isCredentialRecoveryFailure } from './credential-recovery.js'

export const CredentialRecoveryMessage = (props: {
  readonly turn: TurnLocation
  readonly onOpenAccounts: () => void
  readonly hint: string
  readonly actionLabel: string
}): JSX.Element | null => {
  const end = props.turn.end
  if (end?.data.reason.kind !== 'error' || !isCredentialRecoveryFailure(end.data.reason.error)) return null

  return (
    <div className="dshx-root dshx:mt-2 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm">
      <span className="dshx:text-muted-foreground">{props.hint}</span>
      <Button variant="outline" size="sm" onClick={props.onOpenAccounts}>
        <KeyRoundIcon />
        {props.actionLabel}
        <ArrowRightIcon />
      </Button>
    </div>
  )
}
