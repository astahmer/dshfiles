import type { ActionPreview } from './revision-action-machine.js'
import { InlinePanel, InlinePanelActions } from './inline-panel.js'

const DESTRUCTIVE_ACTIONS: ReadonlySet<ActionPreview['kind']> = new Set(['abandon', 'restore', 'bookmark-delete', 'workspace-forget'])

/** The prepared mutation for one revision, confirmed in the row it acts on instead of a modal. */
export const InlineActionConfirm = (props: {
  readonly preview: ActionPreview
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): JSX.Element => (
  <InlinePanel
    label={`Confirm ${props.preview.title.toLocaleLowerCase()}`}
    onCancel={props.onCancel}
    tone={DESTRUCTIVE_ACTIONS.has(props.preview.kind) ? 'destructive' : 'default'}
  >
    <p className="dshx:text-xs dshx:font-medium" role="status">
      {props.preview.summary}
    </p>
    {props.preview.detail.length > 0 && (
      <pre className="dshx:max-h-40 dshx:overflow-auto dshx:rounded-sm dshx:bg-muted dshx:p-2 dshx:font-mono! dshx:text-[11px] dshx:whitespace-pre-wrap">
        {props.preview.detail}
      </pre>
    )}
    <InlinePanelActions
      busy={props.busy}
      confirmLabel={props.preview.title}
      confirmVariant={DESTRUCTIVE_ACTIONS.has(props.preview.kind) ? 'destructive' : 'default'}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  </InlinePanel>
)
