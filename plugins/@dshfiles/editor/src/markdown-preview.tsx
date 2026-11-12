import { FencedMarkdown } from '@dshfiles/chat/fenced-markdown'
import type { FileViewerProps } from '@dshfiles/dshx/client'
import { Markdown } from '@dshfiles/plugin-ui/components/markdown'

/**
 * A workspace file as rendered Markdown. Fences go through Chat's code-fence registry, so a ```` ```mermaid ````
 * diagram shows as a diagram card with its source one click away wherever `@dshfiles/mermaid-diagrams` is active;
 * without that bundle the native code card stands.
 */
export const MarkdownPreview = (props: FileViewerProps): JSX.Element => <Markdown renderText={FencedMarkdown} text={props.text} variant="body" />
