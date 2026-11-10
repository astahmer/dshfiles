import { CodeBlock, FilePath } from '@dshfiles/plugin-ui/components/code-block'
import { ToolCard } from '@dshfiles/plugin-ui/components/tool-card'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import type { ReactNode } from 'react'
import { FileToolModels, type FileToolCall } from './file-tool-models.js'

/** The Host conversation labels this card borrows, so a zh profile reads it like the native rows. */
export type ReadTranslate = (key: 'tool.title.read' | 'read.window', params?: Record<string, string | number>) => string

export interface ReadToolCardProps {
  /** The call material the model reads; the slot owner props satisfy it. */
  readonly call: FileToolCall
  readonly useDisclosure: () => { readonly expanded: boolean; readonly setExpanded: (open: boolean) => void; readonly toggle: () => void }
  /** Opens the file where the model looked; already cwd-resolved. */
  readonly openFile: (path: string, options?: { readonly line?: number }) => void
  readonly t: ReadTranslate
  /** The native `read` row, rendered whenever this card has nothing better, or is missing off. */
  readonly native: ReactNode
}

const hidden = (props: ReadToolCardProps): ReactNode => props.native

/** ToolCard's `title` is the card's visible label, not hover help: it rides a props object so the native-title rule stays about hover help. */
const cardLabel = (title: string) => ({ title })

/**
 * A settled `read` in the shared `CodeBlock`: the window numbered from the offset the call asked for, with the
 * matching grammar, wrap, copy and no download. The card starts closed — a read window can hold thousands of lines —
 * and its path opens the file where the model looked. Anything else (a failed, running, replayed-without-metadata or
 * nested call) stays the native row.
 */
export const ReadToolCard = (props: ReadToolCardProps): ReactNode => {
  const window = FileToolModels.readWindow(props.call)
  const disclosure = props.useDisclosure()
  if (window === undefined) return hidden(props)
  return (
    <ToolCard
      {...cardLabel(props.t('tool.title.read'))}
      meta={props.t('read.window', { shown: window.lineCount, total: window.totalLines })}
      onToggle={disclosure.toggle}
      open={disclosure.expanded}
      status="passed"
      summary={
        <Button
          aria-label={`Open ${window.path}`}
          className="dshx:h-5 dshx:max-w-full dshx:px-1 dshx:font-normal"
          onClick={event => {
            event.stopPropagation()
            props.openFile(window.absolutePath, { line: window.startLine })
          }}
          size="xs"
          type="button"
          variant="ghost"
        >
          <FilePath path={window.path} />
        </Button>
      }
    >
      <div className="dshx:max-h-96 dshx:min-w-0 dshx:overflow-auto dshx:pb-1">
        <CodeBlock code={window.code} downloadable={false} path={window.path} startLine={window.startLine} />
      </div>
    </ToolCard>
  )
}
