import { languageForPath, useCodeHighlighter, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from '../icons.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'

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

/** A path with its folder muted and its file name emphasised. */
export const FilePath = (props: { readonly path: string }): JSX.Element => {
  const slash = props.path.lastIndexOf('/')
  return (
    <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">
      <span className="dshx:text-muted-foreground">{props.path.slice(0, slash + 1)}</span>
      <span className="dshx:font-medium dshx:text-foreground">{props.path.slice(slash + 1)}</span>
    </span>
  )
}

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

/**
 * A few source lines around a failure, highlighted with the Host's grammar for `path` and numbered with the file's own
 * line numbers; the Host `CodeBlock` always counts from 1, which is wrong for a frame cut from the middle of a file.
 */
export const CodeFrame = (props: {
  readonly path: string
  readonly lines: readonly CodeFrameLine[]
  readonly highlightLine?: number | undefined
}): JSX.Element => {
  const highlight = useCodeHighlighter(languageForPath(props.path))
  const source = props.lines.map(line => line.text).join('\n')
  const spans = highlight(source)
  return (
    <div className="dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border">
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1">
        <FilePath path={props.path} />
        <Button
          aria-label="Copy code"
          className="dshx:ml-auto dshx:size-6"
          onClick={() => void writeClipboard(source)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <CopyIcon />
        </Button>
      </div>
      <div className="dshx:overflow-x-auto dshx:py-1.5 dshx:font-mono dshx:text-xs">
        {props.lines.map((line, index) => (
          <div className={cn('dshx:flex dshx:gap-4 dshx:px-3 dshx:whitespace-pre', line.number === props.highlightLine && 'dshx:bg-muted')} key={line.number}>
            <span className="dshx:w-6 dshx:shrink-0 dshx:text-right dshx:text-muted-foreground dshx:select-none">{line.number}</span>
            <span>
              {spans?.[index]?.map((span, spanIndex) => (
                <span key={spanIndex} style={span.style}>
                  {span.text}
                </span>
              )) ?? line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Where an error happened: the location (opens the file when `openFile` is given), its code frame, and the rest of the stack folded away. */
export const StackTrace = (props: {
  readonly location: SourceLocation | undefined
  readonly codeFrame: readonly CodeFrameLine[]
  readonly frames: readonly SourceLocation[]
  readonly openFile?: OpenFile | undefined
}): JSX.Element => {
  const [framesOpen, setFramesOpen] = useState(false)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      {props.location !== undefined && <LocationLink location={props.location} openFile={props.openFile} />}
      {props.codeFrame.length > 0 && <CodeFrame highlightLine={props.location?.line} lines={props.codeFrame} path={props.location?.file ?? ''} />}
      {props.frames.length > 0 && (
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
          <button className="dshx:flex dshx:items-center dshx:gap-1 dshx:self-start" onClick={() => setFramesOpen(open => !open)} type="button">
            {framesOpen ? <ChevronDownIcon className="dshx:size-3.5" /> : <ChevronRightIcon className="dshx:size-3.5" />}
            {props.frames.length} more {props.frames.length === 1 ? 'frame' : 'frames'}
          </button>
          {framesOpen && (
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pl-5">
              {props.frames.map((frame, index) => (
                <LocationLink key={index} location={frame} openFile={props.openFile} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
