import { languageForPath, useCodeHighlighter, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { CheckIcon, CopyIcon, DownloadIcon, WrapTextIcon } from '../icons.js'
import { cn } from '../lib/utils.js'
import { Button } from './ui/button.js'

export interface CodeBlockProps {
  readonly code: string
  /** Names the block in its header, picks the grammar and the download name. */
  readonly path?: string | undefined
  /** Grammar when there is no `path`, or to override the one its extension picks. */
  readonly lang?: string | undefined
  /** Number of the first line, so a fragment cut from line 28 reads 28; `false` hides the gutter. */
  readonly startLine?: number | false
  /** Line numbers, in the file's own numbering, drawn with a muted background. */
  readonly highlightLines?: readonly number[]
  /** Long lines wrap instead of scrolling; the header toggle flips it. */
  readonly defaultWrap?: boolean
  /** Hides the download button (fragments of a larger file, for instance). */
  readonly downloadable?: boolean
  readonly className?: string | undefined
}

const fileName = (path: string): string => path.split(/[/\\]/).at(-1) ?? path

const download = (props: { readonly code: string; readonly name: string }): void => {
  const url = URL.createObjectURL(new Blob([props.code], { type: 'text/plain' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = props.name
  anchor.click()
  URL.revokeObjectURL(url)
}

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

/**
 * Source text highlighted with the Host's lazy Shiki grammars: a header with the path or language, a wrap toggle,
 * copy and download, and a gutter numbered from `startLine`. The Host `CodeBlock` always counts from 1 and has no wrap
 * or download, which is wrong for a frame cut from the middle of a file.
 */
export const CodeBlock = (props: CodeBlockProps): JSX.Element => {
  const [wrap, setWrap] = useState(props.defaultWrap ?? false)
  const [copied, setCopied] = useState(false)
  const language = props.lang ?? (props.path === undefined ? undefined : languageForPath(props.path))
  const highlight = useCodeHighlighter(language)
  const code = props.code.replace(/\n$/, '')
  const lines = code.split('\n')
  const spans = highlight(code)
  const firstLine = props.startLine === false ? undefined : (props.startLine ?? 1)
  const highlighted = new Set(props.highlightLines)
  const gutterWidth = `${String(lines.length - 1 + (firstLine ?? 0)).length}ch`
  const copy = () =>
    void writeClipboard(code).then(ok => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div
      className={cn('dshx:flex dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border', props.className)}
      data-code-block=""
    >
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border dshx:py-0.5 dshx:pr-1 dshx:pl-3">
        {props.path === undefined ? (
          <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{language ?? 'text'}</span>
        ) : (
          <FilePath path={props.path} />
        )}
        <Button
          aria-label="Wrap lines"
          aria-pressed={wrap}
          className={cn('dshx:ml-auto dshx:size-6', wrap && 'dshx:bg-muted')}
          onClick={() => setWrap(value => !value)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <WrapTextIcon />
        </Button>
        <Button aria-label={copied ? 'Copied' : 'Copy code'} className="dshx:size-6" onClick={copy} size="icon" type="button" variant="ghost">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
        {props.downloadable !== false && (
          <Button
            aria-label="Download"
            className="dshx:size-6"
            onClick={() => download({ code, name: props.path === undefined ? `snippet.${language ?? 'txt'}` : fileName(props.path) })}
            size="icon"
            type="button"
            variant="ghost"
          >
            <DownloadIcon />
          </Button>
        )}
      </div>
      <div className={cn('dshx:min-h-0 dshx:py-1.5 dshx:font-mono dshx:text-xs', !wrap && 'dshx:overflow-x-auto')}>
        <div className={cn('dshx:flex dshx:flex-col', !wrap && 'dshx:w-max dshx:min-w-full')}>
          {lines.map((line, index) => {
            const number = firstLine === undefined ? undefined : firstLine + index
            return (
              <div
                className={cn(
                  'dshx:flex dshx:gap-4 dshx:px-3',
                  wrap ? 'dshx:break-all dshx:whitespace-pre-wrap' : 'dshx:whitespace-pre',
                  number !== undefined && highlighted.has(number) && 'dshx:bg-muted',
                )}
                data-line={number}
                key={index}
              >
                {number !== undefined && (
                  <span className="dshx:shrink-0 dshx:text-right dshx:text-muted-foreground dshx:select-none" style={{ width: gutterWidth }}>
                    {number}
                  </span>
                )}
                <span className="dshx:min-w-0">
                  {line === ''
                    ? '\u200b'
                    : (spans?.[index]?.map((span, spanIndex) => (
                        <span key={spanIndex} style={span.style}>
                          {span.text}
                        </span>
                      )) ?? line)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
