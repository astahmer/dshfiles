import { Button } from '@dshfiles/plugin-ui/components/ui/button'

export const QuotaRecoveryModelSwitchButton = (props: {
  readonly expanded: boolean
  readonly disabled: boolean
  readonly onClick: () => void
}): JSX.Element => (
  <Button disabled={props.disabled} onClick={props.onClick} size="xs" type="button" variant="ghost">
    {props.expanded ? 'Hide model options' : 'Resume with another model'}
  </Button>
)
