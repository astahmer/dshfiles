// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Mounted, MountOptions } from 'pele/lazy'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMermaidFence, initialCardState, reduceCard, type MermaidFenceServices } from '../src/mermaid-fence.tsx'
import { moduleUrl, RendererLoadFailed, type RendererLoad } from '../src/renderer-loader.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** A pele stand-in: draws an SVG for valid source and reports a parse error for source containing `bad`. */
const createRenderer = () => ({
  mountAsync: vi.fn(async (element: HTMLElement, text: string, options: MountOptions = {}): Promise<Mounted> => {
    if (text.includes('bad')) options.onError?.(new Error('Parse error on line 1.'))
    else {
      element.innerHTML = `<svg class="pele" viewBox="0 0 10 10"><text>${text}</text></svg>`
      options.onRender?.({ svg: '', width: 10, height: 10, links: [], type: 'flowchart', mermaidType: 'flowchart-v2' })
    }
    const destroy = (): void => element.replaceChildren()
    return { result: undefined, source: text, error: undefined, zoom: undefined, update: () => {}, refresh: () => {}, destroy }
  }),
})

const plainMarker = document.createDocumentFragment()
const mathMarker = document.createDocumentFragment()

/** The services the Client entry passes, with a renderer that loads after `failures` failed downloads. */
const createServices = (options: { readonly failures?: number } = {}) => {
  const renderer = createRenderer()
  let failures = options.failures ?? 0
  const resolver = vi.fn(() => null)
  const services = {
    loader: {
      renderer: vi.fn(async (): Promise<RendererLoad> => {
        if (failures === 0) return { _tag: 'loaded', renderer }
        failures -= 1
        return {
          _tag: 'failed',
          error: new RendererLoadFailed('download', 'The diagram renderer could not be downloaded (offline). Check the connection to DSH and retry.'),
        }
      }),
      math: vi.fn(async () => resolver),
    },
    sanitizers: { plain: vi.fn(() => plainMarker), math: vi.fn(() => mathMarker) },
    writeClipboard: vi.fn(async () => true),
    Lightbox: (props: { readonly src: string; readonly alt: string; readonly onClose: () => void }): ReactNode => (
      <div role="dialog" aria-label={props.alt} data-src={props.src}>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    ),
  } satisfies MermaidFenceServices
  return { services, renderer, resolver }
}

const fenceProps = (code: string, streaming = false) => ({
  code,
  lang: 'mermaid',
  streaming,
  fallback: <pre data-testid="native-card">{code}</pre>,
  source: <pre data-testid="native-source">{code}</pre>,
})

const settle = () => act(async () => {})

describe('mermaid fence', () => {
  it('keeps the native card while the fence is incomplete and loads nothing', () => {
    const { services } = createServices()
    const MermaidFence = createMermaidFence(services)
    render(<MermaidFence {...fenceProps('flowchart LR\n  A --> B', true)} />)
    expect(screen.getByTestId('native-card')).toBeTruthy()
    expect(services.loader.renderer).not.toHaveBeenCalled()
  })

  it('renders the settled diagram with pele, links and images off, through the sanitizer', async () => {
    const { services, renderer } = createServices()
    const MermaidFence = createMermaidFence(services)
    const { container } = render(<MermaidFence {...fenceProps('\n  flowchart LR\n  A --> B\n')} />)
    expect(container.querySelector('.dshfiles-mermaid-placeholder')?.textContent).toContain('A --> B')
    await settle()
    expect(container.querySelector('[data-mermaid-diagram="ready"] svg')).not.toBeNull()
    expect(container.querySelector('.dshfiles-mermaid-placeholder')).toBeNull()
    expect(screen.queryByTestId('native-source')).toBeNull()
    const [, source, options] = renderer.mountAsync.mock.calls[0] ?? []
    expect(source).toBe('flowchart LR\n  A --> B')
    expect(options).toMatchObject({ links: false, images: false, zoom: false, sanitize: services.sanitizers.plain })
    expect(services.loader.math).not.toHaveBeenCalled()
  })

  it('typesets $$ labels through the math loader and the math sanitizer', async () => {
    const { services, renderer, resolver } = createServices()
    const MermaidFence = createMermaidFence(services)
    render(<MermaidFence {...fenceProps('flowchart LR\n  A["$$x^2$$"] --> B')} />)
    await settle()
    expect(renderer.mountAsync.mock.calls[0]?.[2]).toMatchObject({ math: resolver, sanitize: services.sanitizers.math })
  })

  it('toggles between the diagram and its highlighted source', async () => {
    const { services } = createServices()
    const MermaidFence = createMermaidFence(services)
    const { container } = render(<MermaidFence {...fenceProps('flowchart LR\n  A --> B')} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Show code' }))
    expect(screen.getByTestId('native-source')).toBeTruthy()
    expect(container.querySelector('svg.pele')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show diagram' }))
    await settle()
    expect(container.querySelector('[data-mermaid-diagram="ready"] svg.pele')).not.toBeNull()
  })

  it('shows a render error with a recovery hint above the source', async () => {
    const { services } = createServices()
    const MermaidFence = createMermaidFence(services)
    render(<MermaidFence {...fenceProps('flowchart LR\n  bad -->')} />)
    await settle()
    expect(screen.getByRole('alert').textContent).toMatch(/Parse error on line 1\..*ask the agent to correct it/u)
    expect(screen.getByTestId('native-source')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('offers Retry when the renderer cannot be downloaded, and renders after it', async () => {
    const { services } = createServices({ failures: 1 })
    const MermaidFence = createMermaidFence(services)
    const { container } = render(<MermaidFence {...fenceProps('flowchart LR\n  A --> B')} />)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('could not be downloaded')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await settle()
    expect(services.loader.renderer).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-mermaid-diagram="ready"] svg')).not.toBeNull()
  })

  it('expands the diagram into the lightbox and frees the image when it closes', async () => {
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:diagram'), revokeObjectURL })
    const { services } = createServices()
    const MermaidFence = createMermaidFence(services)
    render(<MermaidFence {...fenceProps('flowchart LR\n  A --> B')} />)
    await settle()
    expect(screen.getAllByRole('button', { name: 'Expand diagram' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Expand diagram' }))
    expect(screen.getByRole('dialog', { name: 'Mermaid diagram' }).getAttribute('data-src')).toBe('blob:diagram')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagram')
  })

  it('confirms a copy for a second and clears its timer when the card goes away', async () => {
    vi.useFakeTimers()
    const { services } = createServices()
    const MermaidFence = createMermaidFence(services)
    const { unmount } = render(<MermaidFence {...fenceProps('flowchart LR\n  A --> B')} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Copy source' }))
    await settle()
    expect(services.writeClipboard).toHaveBeenCalledWith('flowchart LR\n  A --> B')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Copy source' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy source' }))
    await settle()
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('mermaid card state', () => {
  it('drops a report from an attempt Retry has replaced', () => {
    const retried = reduceCard(reduceCard(initialCardState, { type: 'failed', attempt: 0, reason: 'download', message: 'offline' }), { type: 'retry' })
    expect(reduceCard(retried, { type: 'rendered', attempt: 0 }).status).toEqual({ kind: 'loading' })
    expect(reduceCard(retried, { type: 'rendered', attempt: 1 }).status).toEqual({ kind: 'ready' })
  })
})

describe('renderer module URL', () => {
  it('adds an attempt query after a failed load so a cached failure is not reused', () => {
    expect(moduleUrl('http://127.0.0.1:1', 'lazy.js', 0)).toBe('http://127.0.0.1:1/dshfiles-mermaid-diagrams/renderer/lazy.js')
    expect(moduleUrl('http://127.0.0.1:1', 'lazy.js', 2)).toBe('http://127.0.0.1:1/dshfiles-mermaid-diagrams/renderer/lazy.js?attempt=2')
  })
})
