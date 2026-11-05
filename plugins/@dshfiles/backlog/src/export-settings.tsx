import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { DownloadIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import { backlogApi } from './api.js'

type ExportFormat = 'jsonl' | 'sqlite'

const placeholders = { jsonl: '/Users/you/backlog.jsonl', sqlite: '/Users/you/backlog.db' } satisfies Record<ExportFormat, string>

/** Settings › Export: writes the backlog to a new file on the Host, the same verb as `backlog_export`. */
export const BacklogExportSettings = (): JSX.Element => {
  const api = useApi(backlogApi)
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('jsonl')
  const [path, setPath] = useState('')
  const [includeOps, setIncludeOps] = useState(false)
  const exporting = useMutation({
    mutationFn: () => api.export({ path: path.trim(), format, ...(format === 'jsonl' && includeOps && { includeOps: true }) }),
  })
  const report = exporting.data
  return (
    <section
      className="dshx-root dshx:@container dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3"
      aria-labelledby="backlog-export-title"
    >
      <h3 id="backlog-export-title" className="dshx:text-base dshx:font-semibold">
        Export
      </h3>
      <div className="dshx:mt-3 dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          <DownloadIcon aria-hidden className="dshx:size-3.5" />
          Export…
        </Button>
        {report === undefined ? null : (
          <p role="status" className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">
            Exported {report.items} items to {report.path}
          </p>
        )}
      </div>
      <Dialog open={open} onOpenChange={next => (exporting.isPending ? undefined : setOpen(next))}>
        <DialogContent className="dshx-root">
          <DialogHeader>
            <DialogTitle>Export the backlog</DialogTitle>
            <DialogDescription>
              Writes a new file on this machine; an existing file is never overwritten. Attachment bytes stay in the backlog folder.
            </DialogDescription>
          </DialogHeader>
          <form
            className="dshx:flex dshx:flex-col dshx:gap-3"
            onSubmit={event => {
              event.preventDefault()
              void exporting
                .mutateAsync()
                .then(() => setOpen(false))
                .catch(() => undefined)
            }}
          >
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Export format"
              value={format}
              onValueChange={value => (value === 'jsonl' || value === 'sqlite' ? setFormat(value) : undefined)}
            >
              <ToggleGroupItem value="jsonl">JSON Lines</ToggleGroupItem>
              <ToggleGroupItem value="sqlite">SQLite copy</ToggleGroupItem>
            </ToggleGroup>
            <input
              type="text"
              aria-label="Export file"
              placeholder={placeholders[format]}
              value={path}
              onChange={event => setPath(event.currentTarget.value)}
              className="dshx:font-mono! dshx:h-9 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-3 dshx:text-sm dshx:outline-none dshx:focus-visible:border-ring"
            />
            {format === 'jsonl' ? (
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                <Switch checked={includeOps} onCheckedChange={setIncludeOps} aria-label="Include the op log" />
                Include the op log
              </label>
            ) : null}
            {exporting.error === null ? null : (
              <p role="alert" className="dshx:text-xs dshx:text-destructive">
                {errorMessage(exporting.error, 'The backlog could not be exported. Check the path and retry.')}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={exporting.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={exporting.isPending || path.trim() === ''}>
                <DownloadIcon aria-hidden className="dshx:size-3.5" />
                Export
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
