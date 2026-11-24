import { HealthDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import type { ServerMark } from './server-status.js'

/** A server's one status mark: its health dot, or the ink working ring while it starts. Same 16 px box, so no shift. */
export const ServerStatusMark = (props: { readonly mark: ServerMark }): JSX.Element =>
  props.mark === 'working' ? (
    <StatusGlyph decorative status="working" />
  ) : (
    <span aria-hidden="true" className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center">
      <HealthDot health={props.mark} />
    </span>
  )
