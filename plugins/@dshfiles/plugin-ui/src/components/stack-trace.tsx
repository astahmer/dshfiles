import { useState } from 'react'
import { ChevronRightIcon } from '../icons.js'
import { cn } from '../lib/utils.js'
import { CodeBlock, FilePath } from './code-block.js'
import type { CallFrame } from './motion/call-stack-tree.js'

export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface CodeFrameLine {
  /** The file's own 1-based line number, so a frame cut from line 28 still reads 28. */
  readonly number: number
  readonly text: string
}

type OpenFile = (path: string, options?: { readonly line?: number }) => void

const LocationLink = (props: { readonly location: SourceLocation; readonly openFile: OpenFile | undefined }): JSX.Element => {
  const label = (
    <>
      <FilePath path={props.location.file} />
      <span className="dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
        :{props.location.line}:{props.location.column}
      </span>
    </>
  )
  if (props.openFile === undefined) return <span className="dshx:flex dshx:min-w-0 dshx:items-baseline">{label}</span>
  return (
    <button
      className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:self-start dshx:text-left dshx:hover:underline"
      onClick={() => props.openFile?.(props.location.file, { line: props.location.line })}
      type="button"
    >
      {label}
    </button>
  )
}

/** A few source lines around a failure, numbered with the file's own line numbers and the failing line marked. */
export const CodeFrame = (props: {
  readonly path: string
  readonly lines: readonly CodeFrameLine[]
  readonly highlightLine?: number | undefined
}): JSX.Element => (
  <CodeBlock
    code={props.lines.map(line => line.text).join('\n')}
    downloadable={false}
    highlightLines={props.highlightLine === undefined ? [] : [props.highlightLine]}
    path={props.path}
    startLine={props.lines[0]?.number ?? 1}
  />
)

/** A vitest-style `file:line:column` location as a call frame with no function name. */
export const locationFrame = (location: SourceLocation, index: number): CallFrame => ({
  id: `location-${String(index)}`,
  name: `${location.file}:${String(location.line)}:${String(location.column)}`,
  path: location.file,
  line: location.line,
  column: location.column,
  bare: true,
  status: /node_modules|^node:/.test(location.file) ? 'existing' : 'changed',
})

type StackRow = { readonly kind: 'frame'; readonly frame: CallFrame } | { readonly kind: 'library'; readonly id: string; readonly frames: readonly CallFrame[] }

/** Each run of consecutive library frames becomes one row, unless the whole stack is library code. */
const stackRows = (frames: readonly CallFrame[]): readonly StackRow[] => {
  if (frames.every(frame => frame.status === 'existing')) return frames.map(frame => ({ kind: 'frame', frame }))
  const rows: StackRow[] = []
  for (const frame of frames) {
    const previous = rows.at(-1)
    if (frame.status !== 'existing') rows.push({ kind: 'frame', frame })
    else if (previous?.kind === 'library') rows[rows.length - 1] = { ...previous, frames: [...previous.frames, frame] }
    else rows.push({ kind: 'library', id: frame.id, frames: [frame] })
  }
  return rows
}

const ROW = 'dshx:flex dshx:min-h-6 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-3 dshx:rounded-sm dshx:px-1.5 dshx:@max-pane-narrow:min-h-11'
const INTERACTIVE_ROW = 'dshx:text-left dshx:font-mono! dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60'

const FrameRow = (props: { readonly frame: CallFrame; readonly openFile: OpenFile | undefined }): JSX.Element => {
  const frame = props.frame
  const library = frame.status === 'existing'
  const label = (
    <>
      <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', library ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}>
        {frame.receiver !== undefined && <span className="dshx:text-muted-foreground">{frame.receiver}.</span>}
        {frame.name}
      </span>
      {frame.bare !== true && frame.file !== undefined && (
        <span className="dshx:max-w-[50%] dshx:shrink-0 dshx:truncate dshx:text-muted-foreground">
          {frame.file}
          {frame.line === undefined ? '' : `:${String(frame.line)}`}
        </span>
      )}
    </>
  )
  const path = frame.path ?? frame.file
  if (props.openFile === undefined || path === undefined) return <div className={ROW}>{label}</div>
  return (
    <button className={cn(ROW, INTERACTIVE_ROW)} onClick={() => props.openFile?.(path, frame.line === undefined ? {} : { line: frame.line })} type="button">
      {label}
    </button>
  )
}

/**
 * Where an error happened: the location (opens the file when `openFile` is given), its code frame, and the call stack as
 * flat mono rows, innermost first. Each run of library and runtime frames (`status: 'existing'`) folds into one row that
 * expands in place; selecting a frame opens its file at its line.
 */
export const StackTrace = (props: {
  readonly location?: SourceLocation | undefined
  readonly codeFrame?: readonly CodeFrameLine[]
  readonly frames: readonly CallFrame[]
  readonly openFile?: OpenFile | undefined
  readonly className?: string | undefined
}): JSX.Element => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setExpanded(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const codeFrame = props.codeFrame ?? []
  return (
    <div className={cn('dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2', props.className)} data-stack-trace="">
      {props.location !== undefined && <LocationLink location={props.location} openFile={props.openFile} />}
      {codeFrame.length > 0 && <CodeFrame highlightLine={props.location?.line} lines={codeFrame} path={props.location?.file ?? ''} />}
      {props.frames.length > 0 && (
        <ul aria-label="Stack frames" className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0 dshx:font-mono dshx:text-xs">
          {stackRows(props.frames).map(row => {
            if (row.kind === 'frame')
              return (
                <li key={row.frame.id}>
                  <FrameRow frame={row.frame} openFile={props.openFile} />
                </li>
              )
            const open = expanded.has(row.id)
            return (
              <li key={row.id}>
                <button aria-expanded={open} className={cn(ROW, INTERACTIVE_ROW, 'dshx:text-muted-foreground')} onClick={() => toggle(row.id)} type="button">
                  <ChevronRightIcon className={cn('dshx:size-3 dshx:shrink-0', open && 'dshx:rotate-90')} />
                  {row.frames.length} library {row.frames.length === 1 ? 'frame' : 'frames'}
                </button>
                {open && (
                  <ul className="dshx:m-0 dshx:list-none dshx:p-0 dshx:pl-4">
                    {row.frames.map(frame => (
                      <li key={frame.id}>
                        <FrameRow frame={frame} openFile={props.openFile} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
