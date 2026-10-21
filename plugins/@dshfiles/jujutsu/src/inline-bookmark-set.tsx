import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { useState } from 'react'
import { InlinePanel, InlinePanelActions } from './inline-panel.js'

/** `jj bookmark set` at one revision: name it in the row, preview it, then confirm like every other mutation. */
export const InlineBookmarkSet = (props: {
  readonly shortestChangeId: string
  readonly onCancel: () => void
  readonly onPreview: (name: string) => void
}): JSX.Element => {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  return (
    <InlinePanel label="Set bookmark" onCancel={props.onCancel}>
      <form
        className="dshx:flex dshx:flex-col dshx:gap-2"
        onSubmit={event => {
          event.preventDefault()
          if (trimmed.length === 0) return
          props.onPreview(trimmed)
        }}
      >
        <Label className="dshx:text-xs dshx:font-medium" htmlFor="jj-inline-bookmark-name">
          Set bookmark at <code className="dshx:font-mono!">{props.shortestChangeId}</code>
        </Label>
        <Input
          aria-label="Bookmark name"
          autoFocus
          className="dshx:h-7 dshx:font-mono! dshx:text-xs dshx:md:text-xs"
          id="jj-inline-bookmark-name"
          onChange={event => setName(event.target.value)}
          pattern="[A-Za-z0-9][A-Za-z0-9._/+:\-]*"
          placeholder="feature/name"
          value={name}
        />
        <InlinePanelActions confirmDisabled={trimmed.length === 0} confirmLabel="Preview" onCancel={props.onCancel} type="submit" />
      </form>
    </InlinePanel>
  )
}
