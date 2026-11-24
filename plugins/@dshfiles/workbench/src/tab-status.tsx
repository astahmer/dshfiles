import { StatusGlyph, workStatusLabels, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { TabStatus } from './tabs.js'

/**
 * The one mapping from a thread tab's status onto the shared work-status vocabulary (DESIGN.md "Status vocabulary").
 * Both tab strips draw it, so a thread shows the same glyph on its tab as in the thread list: working is the
 * colourless ink ring, Needs you the indigo diamond, failed the red cross, an unseen finish (Ready) the green dot.
 */
export const TAB_WORK_STATUS = {
  needsYou: 'needs-you',
  failed: 'failed',
  running: 'working',
  unread: 'ready',
} as const satisfies Record<TabStatus, WorkStatus>

/** The status mark of one thread tab; never a coloured dot of the strip's own. */
export const TabStatusGlyph = (props: {
  readonly status: TabStatus
  /** Accessible name; an empty or missing one falls back to the vocabulary's English label. Ignored when `decorative`. */
  readonly label?: string | undefined
  /** Hide from assistive technology when the tab's own name already says the state. */
  readonly decorative?: boolean
  readonly className?: string
}): JSX.Element => (
  <StatusGlyph
    status={TAB_WORK_STATUS[props.status]}
    label={props.label === undefined || props.label === '' ? workStatusLabels[TAB_WORK_STATUS[props.status]] : props.label}
    decorative={props.decorative ?? false}
    data-tab-status={props.status}
    {...(props.className === undefined ? {} : { className: props.className })}
  />
)
