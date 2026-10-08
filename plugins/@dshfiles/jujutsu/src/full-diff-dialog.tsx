import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useRef } from 'react'
import { FileStatusLetter } from './changed-files.js'
import { parseGitPatch } from './patch-view.js'

interface FullDiffDialogProps {
  readonly title: string
  readonly patch: string | undefined
  readonly truncated: boolean
  readonly error: string | null
  readonly focusPath: string | null
  readonly onClose: () => void
}

const ROW_TONE = {
  context: '',
  addition: 'dshx:bg-success/15',
  deletion: 'dshx:bg-destructive/15',
} as const

const GUTTER_TONE = {
  context: 'dshx:text-muted-foreground',
  addition: 'dshx:border-l-2 dshx:border-success dshx:text-success',
  deletion: 'dshx:border-l-2 dshx:border-destructive dshx:text-destructive',
} as const

/** Every changed file of one revision with numbered hunks, like BB's full-diff overlay. */
export const FullDiffDialog = (props: FullDiffDialogProps): JSX.Element => {
  const files = useMemo(() => (props.patch === undefined ? [] : parseGitPatch(props.patch)), [props.patch])
  const body = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (props.focusPath === null || files.length === 0) return
    const target = body.current?.querySelector(`[data-diff-path="${CSS.escape(props.focusPath)}"]`)
    target?.scrollIntoView({ block: 'start' })
  }, [files, props.focusPath])

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
      open
    >
      <DialogContent
        className="dshx-root dshx:flex dshx:h-[min(88vh,960px)] dshx:max-w-[min(1200px,calc(100vw-2rem))] dshx:flex-col dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-[min(1200px,calc(100vw-2rem))]"
        showCloseButton={false}
      >
        <header className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-3 dshx:border-b dshx:px-3 dshx:py-2">
          <DialogTitle className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-semibold">
            {props.title}
            {props.patch !== undefined && <span className="dshx:font-normal dshx:text-muted-foreground"> · {files.length} files</span>}
          </DialogTitle>
          <DialogDescription className="dshx:sr-only">Full diff of every changed file in this revision.</DialogDescription>
          <Button className="dshx:ml-auto" onClick={props.onClose} size="sm" type="button" variant="outline">
            Close
          </Button>
        </header>
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-contain" ref={body}>
          {props.error !== null && (
            <Alert className="dshx:m-3 dshx:w-auto" variant="destructive">
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          )}
          {props.patch === undefined && props.error === null && (
            <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:p-4 dshx:text-xs dshx:text-muted-foreground">
              <Spinner className="dshx:size-3" />
              Loading revision diff…
            </p>
          )}
          {props.patch !== undefined && files.length === 0 && (
            <p className="dshx:p-4 dshx:text-xs dshx:text-muted-foreground">This revision has no changed files.</p>
          )}
          {files.map(file => (
            <section data-diff-path={file.path} key={file.path}>
              <h3 className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:items-center dshx:gap-2 dshx:border-y dshx:bg-muted dshx:px-3 dshx:py-1.5 dshx:font-mono dshx:text-xs dshx:font-semibold">
                <FileStatusLetter status={file.status} />
                <span className="dshx:min-w-0 dshx:truncate">{file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}</span>
              </h3>
              {file.binary && <p className="dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">Binary file changed.</p>}
              {!file.binary && file.hunks.length === 0 && <p className="dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No content changes.</p>}
              <div className="dshx:py-2 dshx:font-mono dshx:text-[12px] dshx:leading-[18px]">
                {file.hunks.map((hunk, hunkIndex) => (
                  <div key={hunkIndex}>
                    {hunk.unmodifiedBefore > 0 && (
                      <div className="dshx:mx-3 dshx:my-1.5 dshx:rounded-sm dshx:bg-muted dshx:px-2 dshx:py-1 dshx:font-sans dshx:text-xs dshx:text-muted-foreground">
                        {hunk.unmodifiedBefore} unmodified {hunk.unmodifiedBefore === 1 ? 'line' : 'lines'}
                      </div>
                    )}
                    {hunk.rows.map((row, rowIndex) => (
                      <div className={cn('dshx:flex dshx:min-w-max', ROW_TONE[row.kind])} key={rowIndex}>
                        <span className={cn('dshx:w-12 dshx:flex-none dshx:pr-3 dshx:text-right dshx:select-none', GUTTER_TONE[row.kind])}>
                          {row.newLine ?? row.oldLine}
                        </span>
                        <span className="dshx:pr-4 dshx:whitespace-pre">{row.text.length === 0 ? ' ' : row.text}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {props.truncated && <p className="dshx:p-3 dshx:text-xs dshx:text-warning">The diff reached the output limit; later files are missing.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
