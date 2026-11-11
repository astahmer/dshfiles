import { StackTrace } from '@dshfiles/plugin-ui/components/stack-trace'
import { ToolCard } from '@dshfiles/plugin-ui/components/tool-card'
import type { StackTraceReport } from '@dshfiles/plugin-ui/lib/stack-frames'
import { useState } from 'react'

type OpenFile = (path: string, options?: { readonly line?: number }) => void

/** ToolCard's `title` is the card's visible label, not hover help. */
const cardLabel = (title: string) => ({ title })

const headline = (report: StackTraceReport): string => {
  const firstLine = report.message.split('\n')[0] ?? ''
  return firstLine === '' ? report.errorName : `${report.errorName}: ${firstLine}`
}

/** The first error a shell command printed with a stack trace, below the command's own output. */
export const StackTraceCard = (props: { readonly report: StackTraceReport; readonly openFile: OpenFile; readonly defaultOpen: boolean }) => {
  const [open, setOpen] = useState(props.defaultOpen)
  const frames = props.report.frames.length
  return (
    <div data-test-runs-stack-trace="">
      <ToolCard
        {...cardLabel('Stack trace')}
        className="dshx:@container"
        meta={`${String(frames)} ${frames === 1 ? 'frame' : 'frames'}`}
        onToggle={() => setOpen(value => !value)}
        open={open}
        status="failed"
        summary={headline(props.report)}
      >
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-1">
          {props.report.message.includes('\n') && (
            <span className="dshx:font-mono dshx:text-xs dshx:break-words dshx:whitespace-pre-wrap dshx:text-muted-foreground">{props.report.message}</span>
          )}
          <StackTrace frames={props.report.frames} openFile={props.openFile} />
        </div>
      </ToolCard>
    </div>
  )
}
