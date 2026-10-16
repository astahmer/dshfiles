import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'

import { memoryApi } from './api.ts'
import { memoryReferencePreviewEvent, memoryReferencePreviewRequestSchema, type MemoryReferencePreviewRequest } from './memory-reference.ts'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

export const MemoryReferenceOverlay = (): JSX.Element | null => {
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
      <PopoverContent align="start" side="bottom" sideOffset={6} className="dshx-root" data-dshfiles-memory-preview>
        <PopoverHeader>
          <PopoverTitle>
            Memory · {request.id}
            {request.range === undefined ? '' : ` #${request.range}`}
          </PopoverTitle>
        </PopoverHeader>
        {preview.isPending ? <p>Loading memory…</p> : null}
        {preview.isError ? <p>{errorMessage(preview.error, 'Memory reference is unavailable.')}</p> : null}
        {preview.data === undefined ? null : <MarkdownText text={preview.data.summary} labels={markdownLabels} variant="compact" />}
      </PopoverContent>
    </Popover>
  )
}
