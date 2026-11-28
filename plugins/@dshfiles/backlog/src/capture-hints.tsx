import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CircleHelpIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'

const syntax: readonly { readonly key: ReactNode; readonly does: string }[] = [
  { key: <Kbd>⇧↵</Kbd>, does: 'New line' },
  { key: <Kbd>Tab</Kbd>, does: 'Complete a suggestion' },
  { key: <code>bug: idea: note:</code>, does: 'Set the kind' },
  { key: <code>#</code>, does: 'Add a tag' },
  { key: <code>@</code>, does: 'Link an item, a thread or a project' },
  { key: <code>/project</code>, does: 'Set the project' },
  { key: <code>/template</code>, does: 'Start from a template' },
  { key: 'Paste or drop', does: 'Attach a file' },
]

/** The capture box's one standing hint ("↵ add"); every other syntax waits behind "?" until asked for. */
export const CaptureHints = (): JSX.Element => (
  <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-2xs dshx:text-muted-foreground">
    <span className="dshx:@max-pane-narrow:hidden">
      <Kbd>↵</Kbd> add
    </span>
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Capture shortcuts" className="dshx:text-muted-foreground">
          <CircleHelpIcon aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="dshx-root dshx:w-72 dshx:p-3">
        <dl className="dshx:grid dshx:grid-cols-[auto_1fr] dshx:items-center dshx:gap-x-3 dshx:gap-y-1.5 dshx:text-xs">
          {syntax.map(entry => (
            <div key={entry.does} className="dshx:contents">
              <dt className="dshx:font-mono! dshx:text-muted-foreground">{entry.key}</dt>
              <dd>{entry.does}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  </span>
)
