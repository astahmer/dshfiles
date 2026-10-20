import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

const interactiveTargets = 'a, button, input, select, textarea, [role="button"]'

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
    <MarkdownText text={props.text} labels={markdownLabels} variant="compact" />
  </div>
)
