import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { parsePatchFiles, PatchView, type PatchLayout } from '@dshfiles/plugin-ui/diff'
import { useMemo } from 'react'

interface FullDiffDialogProps {
  readonly title: string
  readonly patch: string | undefined
  readonly truncated: boolean
  readonly error: string | null
  readonly focusPath: string | null
  readonly layout: PatchLayout
  readonly onClose: () => void
}

/** Every changed file of one revision, virtualized and syntax-highlighted. */
export const FullDiffDialog = (props: FullDiffDialogProps): JSX.Element => {
  const files = useMemo(() => (props.patch === undefined ? [] : parsePatchFiles(props.patch).flatMap(parsed => parsed.files)), [props.patch])

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
        <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
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
          <PatchView className="dshx:flex-1" files={files} focusPath={props.focusPath} layout={props.layout} />
          {props.truncated && <p className="dshx:p-3 dshx:text-xs dshx:text-warning">The diff reached the output limit; later files are missing.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
