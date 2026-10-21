import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { parsePatchFiles, PatchView, type PatchLayout } from '@dshfiles/plugin-ui/diff'
import { FilePenLineIcon } from '@dshfiles/plugin-ui/icons'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useMemo } from 'react'
import { InlinePanel } from './inline-panel.js'

/** Every changed file of one revision, virtualized and syntax-highlighted, expanded inside its own row. */
export const InlineRevisionDiff = (props: {
  readonly title: string
  readonly patch: string | undefined
  readonly error: string | null
  readonly focusPath: string | null
  readonly layout: PatchLayout
  readonly onCancel: () => void
  readonly onOpenInEditor: (path: string) => void
}): JSX.Element => {
  const files = useMemo(() => (props.patch === undefined ? [] : parsePatchFiles(props.patch).flatMap(parsed => parsed.files)), [props.patch])
  // The diff library virtualizes inside a fixed viewport; a three-line patch should not leave half a screen empty.
  const changedRows = (props.patch ?? '').split('\n').filter(line => /^[+-](?!\+|-)/.test(line)).length
  const viewportHeight = Math.min(560, Math.max(140, changedRows * 22 + 110))
  const label = `Full diff of ${props.title}${props.patch === undefined ? '' : ` · ${String(files.length)} files`}`
  return (
    <InlinePanel label={label} onCancel={props.onCancel}>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs dshx:font-medium" role="status">
          {props.title}
          {props.patch !== undefined && <span className="dshx:font-normal dshx:text-muted-foreground"> · {files.length} files</span>}
        </p>
        <Button onClick={props.onCancel} size="xs" type="button" variant="outline">
          Close
        </Button>
      </div>
      {props.error !== null && (
        <Alert className="dshx:w-auto dshx:px-3 dshx:py-2" variant="destructive">
          <AlertDescription className="dshx:text-xs">{props.error}</AlertDescription>
        </Alert>
      )}
      {props.patch === undefined && props.error === null && (
        <p className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
          <Spinner className="dshx:size-3" />
          Loading revision diff…
        </p>
      )}
      {props.patch !== undefined && files.length === 0 && <p className="dshx:text-xs dshx:text-muted-foreground">This revision has no changed files.</p>}
      {files.length > 0 && (
        <div className="dshx:overflow-hidden dshx:rounded-sm dshx:border dshx:border-border" style={{ height: viewportHeight }}>
          <PatchView
            className="dshx:h-full"
            files={files}
            focusPath={props.focusPath}
            layout={props.layout}
            renderHeaderMetadata={file =>
              file.type === 'deleted' ? null : (
                <Button
                  aria-label={'Open ' + file.name + ' in editor'}
                  onClick={() => props.onOpenInEditor(file.name)}
                  size="xs"
                  title="Open in editor"
                  type="button"
                  variant="ghost"
                >
                  <FilePenLineIcon />
                  Open
                </Button>
              )
            }
          />
        </div>
      )}
    </InlinePanel>
  )
}
