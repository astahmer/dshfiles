import { useState } from 'react'
import { cn } from '../lib/utils.js'
import { CodeBlock, FilePath } from './code-block.js'
import { CallStackTree, type CallFrame } from './motion/call-stack-tree.js'

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

/**
 * Where an error happened: the location (opens the file when `openFile` is given), its code frame, and the call stack
 * as a `CallStackTree`, innermost first. Library and runtime frames (`status: 'existing'`) hide behind a toggle;
 * selecting a frame opens its file at its line.
 */
export const StackTrace = (props: {
  /** The error as one line (`TypeError: price is not a number`); defaults to the frame count. */
  readonly heading?: string | undefined
  readonly location?: SourceLocation | undefined
  readonly codeFrame?: readonly CodeFrameLine[]
  readonly frames: readonly CallFrame[]
  readonly openFile?: OpenFile | undefined
  readonly className?: string | undefined
}): JSX.Element => {
  const [showLibrary, setShowLibrary] = useState(false)
  const libraryCount = props.frames.filter(frame => frame.status === 'existing').length
  const ownCount = props.frames.length - libraryCount
  const visible = showLibrary || ownCount === 0 ? props.frames : props.frames.filter(frame => frame.status !== 'existing')
  const codeFrame = props.codeFrame ?? []
  const openFrame = (id: string) => {
    const frame = props.frames.find(candidate => candidate.id === id)
    const path = frame?.path ?? frame?.file
    if (path === undefined) return
    props.openFile?.(path, frame?.line === undefined ? {} : { line: frame.line })
  }
  return (
    <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2', props.className)} data-stack-trace="">
      {props.location !== undefined && <LocationLink location={props.location} openFile={props.openFile} />}
      {codeFrame.length > 0 && <CodeFrame highlightLine={props.location?.line} lines={codeFrame} path={props.location?.file ?? ''} />}
      {props.frames.length > 0 && (
        <CallStackTree
          className="dshx:gap-2 dshx:rounded-lg dshx:p-3 dshx:@max-pane-narrow:p-2"
          heading={props.heading ?? `${String(props.frames.length)} ${props.frames.length === 1 ? 'frame' : 'frames'}`}
          listLabel="Stack frames"
          roots={visible}
          spacedRoots={false}
          summary={
            <span className="dshx:flex dshx:items-center dshx:gap-3 dshx:text-xs">
              <span>
                {ownCount} in your code
                {libraryCount > 0 && ` · ${String(libraryCount)} in libraries`}
              </span>
              {libraryCount > 0 && ownCount > 0 && (
                <button
                  aria-pressed={showLibrary}
                  className="dshx:text-foreground dshx:underline-offset-2 dshx:hover:underline"
                  onClick={() => setShowLibrary(value => !value)}
                  type="button"
                >
                  {showLibrary ? 'Hide library frames' : 'Show library frames'}
                </button>
              )}
            </span>
          }
          {...(props.openFile === undefined ? {} : { onSelectFrame: openFrame })}
        />
      )}
    </div>
  )
}
