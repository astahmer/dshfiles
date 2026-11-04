import { CheckIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import type { ConnectionTestStep } from '../api.js'

const stepLabels: Record<ConnectionTestStep['step'], string> = { ssh: 'SSH login', runtime: 'DSH runtime', identity: 'multi-host identity' }

export const ConnectionTestSteps = (props: {
  readonly steps: readonly ConnectionTestStep[]
  readonly identity?: { readonly dshVersion: string; readonly profile: string }
}) => (
  <ul className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs" aria-label="Connection test">
    {props.steps.map(step => (
      <li key={step.step} className="dshx:flex dshx:items-center dshx:gap-2">
        {step.ok ? <CheckIcon className="dshx:size-3.5 dshx:text-emerald-500" /> : <XIcon className="dshx:size-3.5 dshx:text-destructive" />}
        {stepLabels[step.step]} <span className="dshx:text-muted-foreground">{step.ms} ms</span>
        {step.ok || step.message === undefined ? null : <span className="dshx:min-w-0 dshx:truncate dshx:text-destructive">{step.message}</span>}
      </li>
    ))}
    {props.identity === undefined ? null : (
      <li className="dshx:text-muted-foreground">
        DSH {props.identity.dshVersion} · profile {props.identity.profile}
      </li>
    )}
  </ul>
)
