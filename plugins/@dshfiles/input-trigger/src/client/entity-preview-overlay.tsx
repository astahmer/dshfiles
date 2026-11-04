/**
 * The one reference-preview card (`entity-registry.ts`): every provider's reference link dispatches
 * `EntityPreview.request`, and this overlay draws the card for whichever kind asked, inside one popover that follows
 * its anchor while the conversation scrolls. Replaces the separate agents, backlog and memory overlays.
 */
import { useRegistry } from '@dshfiles/dshx/client'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useState } from 'react'

import { EntityKinds, EntityPreview, EntityRegistryModel, type EntityAnchorRect, type EntityKind, type EntityPreviewRequest } from '../entity-registry.js'

const widthOf = (kind: EntityKind, request: EntityPreviewRequest): 'default' | 'wide' => {
  const width = kind.previewWidth
  if (width === undefined) return 'default'
  return typeof width === 'function' ? width({ id: request.id, range: request.range }) : width
}

/** Each kind's headless decorations, mounted once while the kind is registered. */
const KindDecorations = (props: { readonly kinds: readonly EntityKind[] }): JSX.Element => (
  <>
    {props.kinds.map(kind => {
      const Decorations = kind.Decorations
      return Decorations === undefined ? null : <Decorations key={kind.kind} />
    })}
  </>
)

export const EntityPreviewOverlay = (): JSX.Element => {
  const kinds = useRegistry(EntityKinds)
  const arranged = useMemo(() => EntityRegistryModel.arrange(kinds), [kinds])
  return (
    <>
      <KindDecorations kinds={arranged} />
      <PreviewCard kinds={arranged} />
    </>
  )
}

const PreviewCard = (props: { readonly kinds: readonly EntityKind[] }): JSX.Element | null => {
  const byKind = useMemo(() => new Map(props.kinds.map(kind => [kind.kind, kind])), [props.kinds])
  const [request, setRequest] = useState<EntityPreviewRequest | null>(null)
  const [anchor, setAnchor] = useState<EntityAnchorRect | null>(null)

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = EntityPreview.decodeRequest(event.detail)
      if (parsed === null) return
      setAnchor(parsed.anchor)
      setRequest(parsed)
    }
    window.addEventListener(EntityPreview.event, open)
    return () => window.removeEventListener(EntityPreview.event, open)
  }, [])

  // A landing message scrolls the conversation; the card follows the reference instead of disappearing under it.
  useEffect(() => {
    if (request === null) return
    const remeasure = (): void => {
      const measurement = EntityPreview.measure(request.anchorId, window.innerHeight)
      if (measurement.kind === 'gone') return
      if (measurement.kind === 'offscreen') {
        setRequest(null)
        return
      }
      setAnchor(measurement.rect)
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [request])

  if (request === null) return null
  const kind = byKind.get(request.kind)
  const Preview = kind?.Preview
  // A kind whose provider unloaded since the click has nothing to draw; the reference stays plain text.
  if (kind === undefined || Preview === undefined) return null
  const box = anchor ?? request.anchor
  const close = (): void => setRequest(null)
  return (
    <Popover open onOpenChange={open => !open && close()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: box.left,
            top: box.top,
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        aria-label={`${kind.label} preview`}
        className={cn(
          'dshx-root dshx:flex dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-0 dshx:overflow-hidden dshx:p-0',
          widthOf(kind, request) === 'wide' ? 'dshx:w-[34rem]' : 'dshx:w-[30rem]',
        )}
        {...{ [EntityPreview.cardAttribute]: request.kind }}
      >
        <Preview key={`${request.kind}:${request.id}:${request.range ?? ''}`} id={request.id} range={request.range} close={close} />
      </PopoverContent>
    </Popover>
  )
}
