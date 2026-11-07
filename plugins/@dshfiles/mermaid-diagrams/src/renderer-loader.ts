import type { MathResolver, mountAsync } from 'pele/lazy'
import { KATEX_ENTRY_FILE, RENDERER_ENTRY_FILE, RENDERER_ROUTE } from './renderer-route.js'

/** The part of pele's `lazy` entry this plugin calls. */
export interface PeleRenderer {
  readonly mountAsync: typeof mountAsync
}

/** Why the renderer is unavailable: the download failed, or the Host serves a build without the expected entry. */
export class RendererLoadFailed extends Error {
  readonly _tag = 'RendererLoadFailed'
  override readonly name = 'RendererLoadFailed'
  constructor(
    readonly reason: 'download' | 'outdated',
    message: string,
  ) {
    super(message)
  }
}

export type RendererLoad = { readonly _tag: 'loaded'; readonly renderer: PeleRenderer } | { readonly _tag: 'failed'; readonly error: RendererLoadFailed }

/** Loads pele, and KaTeX for `$$…$$` labels, from the Host route; one instance per page. */
export interface RendererLoader {
  /** Resolves to the renderer or why it is unavailable; never rejects. A success is kept; a failure is retried next call. */
  readonly renderer: () => Promise<RendererLoad>
  /** A typesetter for math labels, or undefined when KaTeX cannot be loaded (labels then stay readable TeX). */
  readonly math: () => Promise<MathResolver | undefined>
}

interface KatexModule {
  readonly renderToString: (tex: string, options: Record<string, unknown>) => string
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * Math labels: pele has no typesetter, so `$$…$$` goes through KaTeX's MathML output (no fonts or stylesheet needed),
 * measured in a hidden probe. Ported from t3code's `MermaidDiagram.tsx` (MIT).
 */
const createMathResolver = (katex: KatexModule, document: Document): MathResolver => {
  const typeset = new Map<string, ReturnType<MathResolver>>()
  let probe: HTMLDivElement | null = null
  // pele calls this on every layout, including resizes.
  return (tex, size) => {
    const key = `${String(size)}:${tex}`
    if (typeset.has(key)) return typeset.get(key)
    let markup: ReturnType<MathResolver> = null
    try {
      if (probe === null) {
        probe = document.createElement('div')
        probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;display:inline-block;white-space:nowrap'
        document.body.append(probe)
      }
      probe.style.fontSize = `${String(size)}px`
      probe.innerHTML = katex.renderToString(tex, {
        displayMode: true,
        output: 'mathml',
        throwOnError: true,
        // No \href, \url, \htmlClass or other command that emits active HTML.
        trust: false,
        strict: 'ignore',
        maxSize: 20,
        maxExpand: 1000,
      })
      const expression = probe.querySelector('math')
      // The annotation repeats the TeX source; the sanitizer would keep its text.
      expression?.querySelector('annotation')?.remove()
      if (expression !== null) {
        const { width, height } = expression.getBoundingClientRect()
        markup = { html: expression.outerHTML, width, height }
      }
    } catch {
      // Unsupported TeX stays readable as its source.
    }
    typeset.set(key, markup)
    return markup
  }
}

/**
 * Where one renderer module is served. After a failed load the URL gains `?attempt=N`, so a browser that cached the
 * failed module fetch requests it again.
 */
export const moduleUrl = (origin: string, file: string, attempt: number): string =>
  `${origin}${RENDERER_ROUTE}/${file}${attempt === 0 ? '' : `?attempt=${String(attempt)}`}`

/**
 * @param origin - the page origin the Host route lives on.
 * @param document - the page document KaTeX output is measured in.
 */
export const createRendererLoader = (origin: string, document: Document): RendererLoader => {
  let loaded: Promise<RendererLoad> | null = null
  let failures = 0
  let math: Promise<MathResolver | undefined> | null = null
  // A computed specifier: the Client build leaves this a native browser import of the Host route.
  const importModule = (file: string, attempt: number): Promise<unknown> => import(/* @vite-ignore */ moduleUrl(origin, file, attempt))

  const renderer = (): Promise<RendererLoad> => {
    if (loaded !== null) return loaded
    const pending = importModule(RENDERER_ENTRY_FILE, failures).then(
      (namespace): RendererLoad => {
        // SAFETY: a module namespace is an object; `mountAsync` is checked to be a function before it is used.
        const candidate = (namespace as Partial<PeleRenderer>).mountAsync
        return typeof candidate === 'function'
          ? { _tag: 'loaded', renderer: { mountAsync: candidate } }
          : { _tag: 'failed', error: new RendererLoadFailed('outdated', 'The diagram renderer is out of date. Rebuild @dshfiles/mermaid-diagrams, then reload the page.') }
      },
      (cause: unknown): RendererLoad => ({
        _tag: 'failed',
        error: new RendererLoadFailed('download', `The diagram renderer could not be downloaded (${describe(cause)}). Check the connection to DSH and retry.`),
      }),
    )
    loaded = pending
    void pending.then(result => {
      if (result._tag === 'loaded') return
      failures += 1
      loaded = null
    })
    return pending
  }

  const mathResolver = (): Promise<MathResolver | undefined> => {
    math ??= importModule(KATEX_ENTRY_FILE, 0).then(
      namespace => {
        // SAFETY: a module namespace is an object; `renderToString` is checked to be a function before it is used.
        const katex = (namespace as { readonly default?: Partial<KatexModule> }).default
        return typeof katex?.renderToString === 'function' ? createMathResolver({ renderToString: katex.renderToString }, document) : undefined
      },
      () => undefined,
    )
    return math
  }

  return { renderer, math: mathResolver }
}
