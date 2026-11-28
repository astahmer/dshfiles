import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useId, useState, type ReactNode } from 'react'
import { DEFAULT_RECOVERY_POLICY, FAILURE_KINDS, type KindPolicy, type RecoveryPolicy } from './failure-policy.js'

const KIND_FIELDS = ['retries', 'backoffMs', 'lunaReserve', 'failover', 'waitSeconds', 'shrink', 'then'] as const satisfies readonly (keyof KindPolicy)[]

/** One word for the collapsed row: whether any failure option differs from what ships. */
export const failureHandlingSummary = (input: { readonly policy: RecoveryPolicy; readonly stalledStreamFallback: boolean }): 'default' | 'customised' =>
  !input.stalledStreamFallback && FAILURE_KINDS.every(kind => KIND_FIELDS.every(field => input.policy[kind][field] === DEFAULT_RECOVERY_POLICY[kind][field]))
    ? 'default'
    : 'customised'

/**
 * The failure options are about twenty controls most people never touch, so Settings shows one row
 * ("Failure handling: default") and opens them on Edit. Nothing is removed.
 */
export const FailureHandlingDisclosure = (props: {
  readonly summary: 'default' | 'customised'
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}): JSX.Element => {
  const [open, setOpen] = useState(props.defaultOpen === true)
  const panelId = useId()
  return (
    <>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-4 dshx:gap-y-1.5">
        <p className="dshx:text-sm">{`Failure handling: ${props.summary}`}</p>
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={open ? 'Close failure handling' : 'Edit failure handling'}
          onClick={() => setOpen(!open)}
          size="sm"
          type="button"
          variant="outline"
        >
          {open ? 'Done' : 'Edit'}
        </Button>
      </div>
      {open ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-3" id={panelId}>
          {props.children}
        </div>
      ) : null}
    </>
  )
}
