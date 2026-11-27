import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import type { VibeBridge } from './api.js'

/**
 * The per-account transport switch: `headless` runs the `vibe` CLI once per step (no DSH tools), `acp` keeps one
 * `vibe-acp` process per thread with DSH's read-only tools and every mutation bridged back through DSH.
 */
export const VibeBridgeSwitch = (props: {
  readonly bridge: VibeBridge
  readonly disabled: boolean
  readonly onChange: (bridge: VibeBridge) => void
}): JSX.Element => (
  <div className="dshx:grid dshx:min-w-0 dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:@max-pane-narrow:grid-cols-1">
    <span className="dshx:flex dshx:flex-col dshx:gap-1">
      <span className="dshx:text-sm dshx:font-medium">Bridge</span>
      <small className="dshx:text-xs dshx:text-muted-foreground">
        ACP keeps one <code>vibe-acp</code> process per thread and runs Vibe's file edits and commands through DSH's tools, approvals and diffs. Headless runs{' '}
        <code>vibe</code> once per step without DSH's tools.
      </small>
    </span>
    <div aria-label="Vibe bridge" className="dshx:flex dshx:gap-1 dshx:rounded-lg dshx:bg-muted dshx:p-1" role="group">
      {(['headless', 'acp'] as const).map(bridge => (
        <Button
          aria-pressed={bridge === props.bridge}
          className={
            bridge === props.bridge ? 'dshx:min-w-0 dshx:flex-1 dshx:bg-background dshx:text-xs dshx:shadow-s1' : 'dshx:min-w-0 dshx:flex-1 dshx:text-xs'
          }
          disabled={props.disabled}
          key={bridge}
          onClick={() => {
            if (bridge !== props.bridge) props.onChange(bridge)
          }}
          size="sm"
          type="button"
          variant={bridge === props.bridge ? 'secondary' : 'ghost'}
        >
          {bridge === 'headless' ? 'Headless CLI' : 'ACP host tools'}
        </Button>
      ))}
    </div>
  </div>
)
