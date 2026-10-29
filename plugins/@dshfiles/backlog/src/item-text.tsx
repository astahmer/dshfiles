import { Markdown } from '@dshfiles/plugin-ui/components/markdown'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

/** Markdown and chips put real controls inside an item row; a gesture the reader meant for one of them is not the row's. */
export const interactiveTargets = 'a, button, input, select, textarea, [role="button"]'

export const BacklogText = (props: { readonly text: string; readonly className?: string; readonly onActivate?: () => void }): JSX.Element => (
  <div
    className={cn('dshx:min-w-0', props.className)}
    onClick={event => {
      if (event.target instanceof Element && event.target.closest(interactiveTargets) !== null) {
        event.stopPropagation()
        return
      }
      props.onActivate?.()
    }}
  >
    <Markdown text={props.text} />
  </div>
)
