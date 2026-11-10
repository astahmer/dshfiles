import type { CodeFenceProps } from '@dshfiles/chat/code-fences'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, CodeIcon, CopyIcon, WorkflowIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useReducer, useRef, type ComponentType, type Dispatch, type ReactNode } from 'react'
import type { RendererLoader } from './renderer-loader.js'
import type { DiagramSanitizers } from './sanitize.js'

/** What the card needs from the page; the Client entry passes the real ones, tests pass fakes. */
export interface MermaidFenceServices {
  readonly loader: RendererLoader
  readonly sanitizers: DiagramSanitizers
  readonly writeClipboard: (text: string) => Promise<boolean>
  /** The full-size viewer for the expanded diagram image. */
  readonly Lightbox: ComponentType<{ readonly src: string; readonly alt: string; readonly onClose: () => void }>
}

/** Where the diagram is: its renderer is loading, it rendered, or the renderer or the source failed. */
export type DiagramStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: 'download' | 'outdated' | 'render'; readonly message: string }

/** Everything one card shows; the reducer below is its only writer. */
export interface CardState {
  readonly view: 'diagram' | 'code'
  /** Bumped by Retry; a mount reports for the attempt it started, so a late report of an earlier one is dropped. */
  readonly attempt: number
  readonly status: DiagramStatus
  readonly copied: boolean
  /** The expanded diagram's image URL while the lightbox is open. */
  readonly expanded: string | null
}

export type CardEvent =
  | { readonly type: 'show-code' }
  | { readonly type: 'show-diagram' }
  | { readonly type: 'rendered'; readonly attempt: number }
  | { readonly type: 'failed'; readonly attempt: number; readonly reason: 'download' | 'outdated' | 'render'; readonly message: string }
  | { readonly type: 'retry' }
  | { readonly type: 'copied' }
  | { readonly type: 'copy-settled' }
  | { readonly type: 'expand'; readonly url: string }
  | { readonly type: 'collapse' }

const LOADING: DiagramStatus = { kind: 'loading' }

export const initialCardState: CardState = { view: 'diagram', attempt: 0, status: LOADING, copied: false, expanded: null }

export const reduceCard = (state: CardState, event: CardEvent): CardState => {
  switch (event.type) {
    case 'show-code':
      return { ...state, view: 'code' }
    case 'show-diagram':
      // The canvas mounts again, so the diagram renders again.
      return { ...state, view: 'diagram', status: LOADING }
    case 'rendered':
      return event.attempt === state.attempt ? { ...state, status: { kind: 'ready' } } : state
    case 'failed':
      return event.attempt === state.attempt ? { ...state, status: { kind: 'failed', reason: event.reason, message: event.message } } : state
    case 'retry':
      return { ...state, attempt: state.attempt + 1, status: LOADING }
    case 'copied':
      return { ...state, copied: true }
    case 'copy-settled':
      return { ...state, copied: false }
    case 'expand':
      return { ...state, expanded: event.url }
    case 'collapse':
      return { ...state, expanded: null }
  }
}

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== '' ? error.message : 'The diagram could not be rendered.')

/** pele colors a diagram through these; a standalone image cannot inherit them, so the expanded copy inlines them. */
const PELE_VARIABLES = [
  '--pele-bg',
  '--pele-fg',
  '--pele-muted',
  '--pele-line',
  '--pele-surface',
  '--pele-surface-alt',
  '--pele-border',
  '--pele-accent',
  '--pele-critical',
  '--pele-font',
  '--pele-font-mono',
  ...Array.from({ length: 8 }, (_, index) => `--pele-series-${String(index + 1)}`),
]

/** An SVG file of the rendered diagram with the current theme baked in, for the full-size lightbox. */
const diagramImageUrl = (svg: SVGSVGElement): string => {
  // SAFETY: cloneNode of an SVGSVGElement returns an SVGSVGElement.
  const copy = svg.cloneNode(true) as SVGSVGElement
  const computed = getComputedStyle(svg)
  for (const name of PELE_VARIABLES) {
    const value = computed.getPropertyValue(name).trim()
    if (value !== '') copy.style.setProperty(name, value)
  }
  copy.style.maxWidth = 'none'
  copy.style.backgroundColor = computed.getPropertyValue('--pele-bg').trim()
  return URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
}

const IconAction = (props: { readonly label: string; readonly onClick: () => void; readonly children: ReactNode }): ReactNode => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="dshfiles-mermaid-action" aria-label={props.label} onClick={props.onClick}>
        {props.children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">{props.label}</TooltipContent>
  </Tooltip>
)

interface DiagramCanvasProps {
  readonly code: string
  readonly attempt: number
  readonly status: DiagramStatus
  readonly services: MermaidFenceServices
  readonly dispatch: Dispatch<CardEvent>
}

/**
 * Mounts pele into a span and reports to the card. pele measures text and fits the layout to the container, so it
 * renders in the page rather than to a string; new source or a retry mounts again. Clicking the diagram expands it.
 */
const DiagramCanvas = ({ code, attempt, status, services, dispatch }: DiagramCanvasProps): ReactNode => {
  const canvas = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    let cancelled = false
    let mounted: { readonly destroy: () => void } | undefined
    const fail = (reason: 'download' | 'outdated' | 'render', message: string): void => {
      if (!cancelled) dispatch({ type: 'failed', attempt, reason, message })
    }
    const source = code.trim()
    const mount = async (): Promise<void> => {
      const load = await services.loader.renderer()
      if (cancelled) return
      if (load._tag === 'failed') return fail(load.error.reason, load.error.message)
      const math = source.includes('$$') ? await services.loader.math() : undefined
      if (cancelled) return
      const result = await load.renderer.mountAsync(element, source, {
        links: false,
        images: false,
        zoom: false,
        // Keep the author's direction; a wide diagram scales down to fit instead of turning vertical.
        autoDirection: false,
        ...(math === undefined ? { sanitize: services.sanitizers.plain } : { math, sanitize: services.sanitizers.math }),
        onRender: () => {
          if (!cancelled) dispatch({ type: 'rendered', attempt })
        },
        onError: error => fail('render', messageOf(error)),
      })
      if (cancelled) result.destroy()
      else mounted = result
    }
    // mountAsync rejects when a diagram type's parser cannot be fetched; that is a download failure, retried by Retry.
    mount().catch((cause: unknown) =>
      fail('download', `The diagram renderer could not be downloaded (${messageOf(cause)}). Check the connection to DSH and retry.`),
    )
    return () => {
      cancelled = true
      mounted?.destroy()
    }
  }, [code, attempt, services, dispatch])

  return (
    <button
      type="button"
      className="dshfiles-mermaid-zoom"
      aria-label="Expand diagram"
      hidden={status.kind === 'failed'}
      onClick={event => {
        const svg = event.currentTarget.querySelector('svg')
        if (svg !== null) dispatch({ type: 'expand', url: diagramImageUrl(svg) })
      }}
    >
      {/* While pele loads, the source holds the card at the code's height, so the page does not jump. */}
      {status.kind === 'loading' && (
        <pre className="dshfiles-mermaid-placeholder" aria-hidden>
          {code}
        </pre>
      )}
      <span ref={canvas} className="dshfiles-mermaid-canvas" data-state={status.kind} />
    </button>
  )
}

/**
 * A ```` ```mermaid ```` fence as a diagram card. Until the fence is complete (Chat says so once another block follows
 * it or the message settles) the native code card stays, so a half-written diagram never flashes errors. Code shows the
 * highlighted source in the same card; source pele cannot render shows its error above the source.
 */
export const createMermaidFence = (services: MermaidFenceServices): ComponentType<CodeFenceProps> => {
  const MermaidFence = (props: CodeFenceProps): ReactNode => {
    const [state, dispatch] = useReducer(reduceCard, initialCardState)

    useEffect(() => {
      if (!state.copied) return
      const timer = window.setTimeout(() => dispatch({ type: 'copy-settled' }), 1000)
      return () => window.clearTimeout(timer)
    }, [state.copied])

    useEffect(() => (state.expanded === null ? undefined : () => URL.revokeObjectURL(state.expanded ?? '')), [state.expanded])

    if (props.streaming || props.code.trim() === '') return props.fallback

    const showDiagram = state.view === 'diagram'
    const failed = state.status.kind === 'failed' ? state.status : undefined
    const Lightbox = services.Lightbox
    const copy = (): void => {
      void services.writeClipboard(props.code).then(ok => {
        if (ok) dispatch({ type: 'copied' })
      })
    }

    return (
      <TooltipProvider>
        <figure className="dshfiles-mermaid" data-mermaid-diagram={showDiagram ? state.status.kind : 'code'} aria-label="Mermaid diagram">
          <div className="dshfiles-mermaid-header">
            <span className="dshfiles-mermaid-language">{props.lang}</span>
            <div className="dshfiles-mermaid-actions">
              {showDiagram ? (
                <IconAction label="Show code" onClick={() => dispatch({ type: 'show-code' })}>
                  <CodeIcon />
                </IconAction>
              ) : (
                <IconAction label="Show diagram" onClick={() => dispatch({ type: 'show-diagram' })}>
                  <WorkflowIcon />
                </IconAction>
              )}
              <IconAction label={state.copied ? 'Copied' : 'Copy source'} onClick={copy}>
                {state.copied ? <CheckIcon /> : <CopyIcon />}
              </IconAction>
            </div>
          </div>
          <div className="dshfiles-mermaid-body">
            {showDiagram && failed !== undefined && (
              <p className="dshfiles-mermaid-error" role="alert">
                <span>
                  {failed.reason === 'render'
                    ? `Unable to render this diagram: ${failed.message} Fix the Mermaid source, or ask the agent to correct it.`
                    : failed.message}
                </span>
                {failed.reason === 'download' && (
                  <button type="button" onClick={() => dispatch({ type: 'retry' })}>
                    Retry
                  </button>
                )}
              </p>
            )}
            {showDiagram && <DiagramCanvas code={props.code} attempt={state.attempt} status={state.status} services={services} dispatch={dispatch} />}
            {(!showDiagram || failed !== undefined) && props.source}
          </div>
          {state.expanded !== null && <Lightbox src={state.expanded} alt="Mermaid diagram" onClose={() => dispatch({ type: 'collapse' })} />}
        </figure>
      </TooltipProvider>
    )
  }
  return MermaidFence
}
