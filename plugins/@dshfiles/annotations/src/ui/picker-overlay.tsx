import { useEffect, useState, type JSX } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useApi, useResource } from '@dshfiles/dshx/client'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { annotationsApi } from '../api.js'
import { formatAnnotationBlock } from '../draft.js'
import { annotationsListInput, annotationsListResource } from '../list-poll.js'
import type { AnnotationIntent, AnnotationSeverity } from '../schema.js'
import { PickClickGuard, PickSession, type DragBox } from './pick-session.js'
import { annotationsUi, useAnnotationsUi, type PickedTarget, type PickMode } from './state.js'

const INTENTS: readonly AnnotationIntent[] = ['fix', 'change', 'question', 'approve']
const SEVERITIES: readonly AnnotationSeverity[] = ['blocking', 'important', 'suggestion']

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const boxOf = (element: Element): Box => {
  const rect = element.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

const labelOf = (element: Element): string => {
  const tag = element.tagName.toLowerCase()
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length === 0 ? tag : `${tag} "${text.slice(0, 40)}"`
}

const CommentForm = ({ picked }: { readonly picked: PickedTarget }): JSX.Element => {
  const api = useApi(annotationsApi)
  const ui = useAnnotationsUi()
  const [note, setNote] = useState('')
  const [intent, setIntent] = useState<AnnotationIntent | null>('fix')
  const [severity, setSeverity] = useState<AnnotationSeverity | null>('important')
  const [error, setError] = useState<string | null>(null)
  const { scope, owner } = ui
  // The action's list read: the same input and options reach the same page-wide resource, so refreshing here also
  // refreshes the badge and the panel the user opens next.
  const list = useResource(annotationsApi, 'list', annotationsListInput({ scope: scope ?? '' }), { ...annotationsListResource, enabled: false })
  const create = useMutation({
    mutationFn: async (pickAgain: boolean) => {
      if (scope === null) throw new Error('Open a thread first, or a Backlog item.')
      const created = await runHostRequest({
        request: signal =>
          api.create(
            {
              sessionId: scope,
              items: [
                {
                  kind: picked.mode === 'region' ? 'region' : 'element',
                  target: picked.target,
                  note: note.trim(),
                  ...(intent !== null && { intent }),
                  ...(severity !== null && { severity }),
                },
              ],
            },
            { signal },
          ),
      })
      return { created, pickAgain }
    },
    onSuccess: ({ created, pickAgain }) => {
      list.refetch()
      const block = formatAnnotationBlock({ annotations: created.annotations })
      if (block.length > 0 && owner !== null && !annotationsUi.insertIntoDraft({ owner, text: block })) {
        setError('Saved, but the draft did not take it. Close this and add it from the panel.')
        return
      }
      if (pickAgain && scope !== null && owner !== null) annotationsUi.beginPick({ scope, owner, mode: picked.mode })
      else annotationsUi.clearPicked()
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not save the annotation.')
    },
  })
  const left = Math.max(8, Math.min(picked.point.x, window.innerWidth - 372))
  const top = Math.max(8, Math.min(picked.point.y + 12, window.innerHeight - 340))

  return (
    <div
      data-annotations-ui="form"
      className="dshx-root dshx:pointer-events-auto dshx:fixed dshx:z-[2147483001] dshx:w-[360px] dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-3 dshx:text-popover-foreground dshx:shadow-lg"
      style={{ left, top }}
    >
      <p className="dshx:mb-1 dshx:text-xs dshx:font-medium">
        {picked.mode === 'region' ? 'area' : picked.target.tag} {picked.target.text === undefined ? '' : `“${picked.target.text.slice(0, 48)}”`}
      </p>
      <p className="dshx:mb-2 dshx:truncate dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{picked.target.selector}</p>
      <Textarea
        autoFocus
        value={note}
        onChange={event => setNote(event.target.value)}
        placeholder="What is wrong or what should change?"
        className="dshx:min-h-16 dshx:text-sm"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            annotationsUi.clearPicked()
          }
        }}
      />
      <div className="dshx:mt-2 dshx:flex dshx:flex-wrap dshx:gap-1">
        <ToggleGroup type="single" size="sm" value={intent ?? ''} onValueChange={value => setIntent(value === '' ? null : (value as AnnotationIntent))}>
          {INTENTS.map(value => (
            <ToggleGroupItem key={value} value={value} className="dshx:h-6 dshx:px-2 dshx:text-[11px]">
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup type="single" size="sm" value={severity ?? ''} onValueChange={value => setSeverity(value === '' ? null : (value as AnnotationSeverity))}>
          {SEVERITIES.map(value => (
            <ToggleGroupItem key={value} value={value} className="dshx:h-6 dshx:px-2 dshx:text-[11px]">
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {error === null ? null : <p className="dshx:mt-2 dshx:text-xs dshx:text-destructive">{error}</p>}
      <div className="dshx:mt-3 dshx:flex dshx:items-center dshx:justify-end dshx:gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => annotationsUi.clearPicked()}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={create.isPending} onClick={() => create.mutate(true)}>
          Add & pick another
        </Button>
        <Button type="button" size="sm" disabled={create.isPending} onClick={() => create.mutate(false)}>
          Add
        </Button>
      </div>
    </div>
  )
}

const modeHint = (mode: PickMode): string => (mode === 'region' ? 'Drag an area · Esc to cancel' : 'Click an element · Esc to cancel')

export const PickerOverlay = (): JSX.Element | null => {
  const ui = useAnnotationsUi()
  const [hover, setHover] = useState<{ box: Box; label: string } | null>(null)
  const [drag, setDrag] = useState<DragBox | null>(null)

  useEffect(() => PickClickGuard.install(), [])

  useEffect(() => {
    if (!ui.pickMode) {
      setHover(null)
      setDrag(null)
      return
    }
    return PickSession.install({
      mode: ui.mode,
      url: () => window.location.href,
      handlers: {
        onHover: element => setHover(element === null ? null : { box: boxOf(element), label: labelOf(element) }),
        onDrag: setDrag,
        onPicked: result => annotationsUi.picked({ target: result.target, point: result.point, mode: result.mode }),
        onCancel: () => annotationsUi.cancelPick(),
      },
    })
  }, [ui.pickMode, ui.mode])

  const dragBox =
    drag === null
      ? null
      : {
          x: Math.min(drag.start.x, drag.current.x),
          y: Math.min(drag.start.y, drag.current.y),
          width: Math.abs(drag.current.x - drag.start.x),
          height: Math.abs(drag.current.y - drag.start.y),
        }

  return (
    <div data-annotations-ui="overlay" className="dshx-root dshx:pointer-events-none dshx:fixed dshx:inset-0 dshx:z-[2147483000]">
      {ui.pickMode ? (
        <>
          <div className="dshx:absolute dshx:top-3 dshx:left-1/2 dshx:-translate-x-1/2 dshx:rounded-full dshx:bg-primary dshx:px-3 dshx:py-1 dshx:text-xs dshx:font-medium dshx:text-primary-foreground dshx:shadow">
            {modeHint(ui.mode)}
          </div>
          {hover === null ? null : (
            <div
              className="dshx:absolute dshx:rounded-sm dshx:border-2 dshx:border-primary dshx:bg-primary/10"
              style={{ left: hover.box.x, top: hover.box.y, width: hover.box.width, height: hover.box.height }}
            >
              <span className="dshx:absolute dshx:-top-6 dshx:left-0 dshx:max-w-72 dshx:truncate dshx:rounded dshx:bg-primary dshx:px-1.5 dshx:py-0.5 dshx:text-[11px] dshx:text-primary-foreground">
                {hover.label}
              </span>
            </div>
          )}
          {dragBox === null ? null : (
            <div
              className="dshx:absolute dshx:rounded-sm dshx:border-2 dshx:border-dashed dshx:border-primary dshx:bg-primary/10"
              style={{ left: dragBox.x, top: dragBox.y, width: dragBox.width, height: dragBox.height }}
            >
              <span className="dshx:absolute dshx:-top-6 dshx:left-0 dshx:rounded dshx:bg-primary dshx:px-1.5 dshx:py-0.5 dshx:text-[11px] dshx:text-primary-foreground">
                {dragBox.width}×{dragBox.height}
              </span>
            </div>
          )}
        </>
      ) : null}
      {ui.picked === null ? null : <CommentForm picked={ui.picked} />}
    </div>
  )
}
