import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'

import { memoryApi } from './api.ts'
import { memoryReferencePreviewEvent, memoryReferencePreviewRequestSchema, type MemoryReferencePreviewRequest } from './memory-reference.ts'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

export const MemoryReferenceOverlay = (props: {
  /** Opens the Memory page on this item, the way the sidebar's Memory row would. */
  readonly openInMemory: (focus: { readonly id: string; readonly range?: string }) => void
}): JSX.Element | null => {
  const api = useApi(memoryApi)
  const [request, setRequest] = useState<MemoryReferencePreviewRequest | null>(null)
  const preview = useQuery({
    queryKey: ['dshfiles-memory', 'reference-preview', request?.id, request?.range],
    enabled: request !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('No memory reference is selected.')
      const input = request.range === undefined ? { id: request.id } : { id: request.id, range: request.range }
      return api.preview(input, { signal })
    },
  })

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = memoryReferencePreviewRequestSchema.safeParse(event.detail)
      if (parsed.success) setRequest(parsed.data)
    }
    const closeOnScroll = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-dshfiles-memory-preview]') !== null) return
      setRequest(null)
    }
    const close = (): void => setRequest(null)
    window.addEventListener(memoryReferencePreviewEvent, open)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener(memoryReferencePreviewEvent, open)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [])

  if (request === null) return null
  return (
    <Popover open onOpenChange={open => !open && setRequest(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: request.anchor.left,
            top: request.anchor.top,
            width: Math.max(1, request.anchor.width),
            height: Math.max(1, request.anchor.height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="dshx-root dshx:w-[44rem] dshx:max-w-[calc(100vw-1rem)]"
        data-dshfiles-memory-preview
      >
        <PopoverHeader>
          <PopoverTitle>
            Memory · {request.id}
            {request.range === undefined ? '' : ` #${request.range}`}
          </PopoverTitle>
        </PopoverHeader>
        <div className="dshx:max-h-[52vh] dshx:overflow-auto">
          {preview.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Loading memory…</p> : null}
          {preview.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(preview.error, 'Memory reference is unavailable.')}
            </p>
          ) : null}
          {preview.data === undefined ? null : <MarkdownText text={preview.data.summary} labels={markdownLabels} variant="compact" />}
        </div>
        <div className="dshx:flex dshx:justify-end">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              props.openInMemory(request.range === undefined ? { id: request.id } : { id: request.id, range: request.range })
              setRequest(null)
            }}
          >
            Open in Memory
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
