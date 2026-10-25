import { useEffect, useMemo, useState, type JSX } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { useApi } from '@dshfiles/dshx/client'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { annotationsApi } from '../api.js'
import { buildPreviewDocument } from '../preview-document.js'
import type { AnnotationTarget } from '../schema.js'

interface PreviewDocument {
  readonly path: string
  readonly html: string
}

export const PreviewDialog = ({
  open,
  onOpenChange,
  sessionId,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly sessionId: string
}): JSX.Element => {
  const api = useApi(annotationsApi)
  const queryClient = useQueryClient()
  const nonce = useMemo(() => crypto.randomUUID(), [])
  const [path, setPath] = useState('')
  const [document, setDocument] = useState<PreviewDocument | null>(null)
  const [picked, setPicked] = useState<AnnotationTarget | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useMutation({
    mutationFn: async (file: string) => runHostRequest({ request: signal => api.preview({ path: file }, { signal }) }),
    onSuccess: result => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setPicked(null)
      setDocument({ path: result.path, html: buildPreviewDocument({ html: result.html, nonce }) })
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not read that file.'),
  })

  const create = useMutation({
    mutationFn: async (input: { readonly target: AnnotationTarget; readonly note: string }) =>
      runHostRequest({
        request: signal =>
          api.create(
            {
              sessionId,
              items: [
                {
                  kind: 'element',
                  target: { ...input.target, source: { file: document?.path ?? input.target.url, line: 1, column: 0, confidence: 'file' } },
                  note: input.note,
                },
              ],
            },
            { signal },
          ),
      }),
    onSuccess: async () => {
      setPicked(null)
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['annotations', sessionId] })
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not save the annotation.'),
  })

  useEffect(() => {
    if (!open) return
    const onMessage = (event: MessageEvent): void => {
      const data: unknown = event.data
      if (typeof data !== 'object' || data === null) return
      const envelope = data as { readonly __dshAnnotations?: unknown; readonly kind?: unknown; readonly target?: unknown }
      if (envelope.__dshAnnotations !== nonce || envelope.kind !== 'pick' || typeof envelope.target !== 'object') return
      setPicked(envelope.target as AnnotationTarget)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, nonce])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dshx-root dshx:flex dshx:h-[80vh] dshx:max-w-3xl dshx:flex-col dshx:gap-2">
        <DialogHeader>
          <DialogTitle>Annotate an HTML preview</DialogTitle>
          <DialogDescription>A workspace-relative path. The page&apos;s own scripts are removed and the frame is sandboxed.</DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Input
            value={path}
            onChange={event => setPath(event.target.value)}
            placeholder="docs/example.html"
            spellCheck={false}
            className="dshx:h-8 dshx:font-mono dshx:text-xs"
            onKeyDown={event => {
              if (event.key === 'Enter' && path.trim().length > 0) load.mutate(path.trim())
            }}
          />
          <Button type="button" size="sm" disabled={path.trim().length === 0 || load.isPending} onClick={() => load.mutate(path.trim())}>
            Open
          </Button>
        </div>
        {error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{error}</p>}
        {picked === null ? null : (
          <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:p-2">
            <p className="dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{picked.selector}</p>
            <Textarea
              autoFocus
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="What is wrong or what should change?"
              className="dshx:min-h-14 dshx:text-sm"
            />
            <div className="dshx:flex dshx:justify-end dshx:gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={create.isPending} onClick={() => create.mutate({ target: picked, note: note.trim() })}>
                Add annotation
              </Button>
            </div>
          </div>
        )}
        <div className="dshx:min-h-0 dshx:flex-1 dshx:rounded-md dshx:border">
          {document === null ? (
            <p className="dshx:flex dshx:h-full dshx:items-center dshx:justify-center dshx:text-xs dshx:text-muted-foreground">
              Open an HTML file to preview and annotate it.
            </p>
          ) : (
            <iframe
              title={`Preview of ${document.path}`}
              sandbox="allow-scripts"
              srcDoc={document.html}
              className="dshx:h-full dshx:w-full dshx:rounded-md dshx:bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
