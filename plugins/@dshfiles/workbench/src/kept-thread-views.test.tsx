import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { KeptThreadViews } from './kept-thread-views.js'

const mounts: string[] = []
const unmounts: string[] = []

const Conversation = (props: { readonly sessionId: string }): JSX.Element => {
  useEffect(() => {
    mounts.push(props.sessionId)
    return () => {
      unmounts.push(props.sessionId)
    }
  }, [props.sessionId])
  return (
    <div data-conversation={props.sessionId}>
      <div data-scroller={props.sessionId} />
    </div>
  )
}

const Panels = (props: { readonly kept: KeptThreadViews; readonly shown: readonly string[] }): JSX.Element => (
  <>
    <props.kept.Host />
    {props.shown.map(sessionId => (
      <section key={sessionId} data-panel={sessionId}>
        <props.kept.Outlet sessionId={sessionId} render={() => <Conversation sessionId={sessionId} />} />
      </section>
    ))}
  </>
)

afterEach(() => {
  cleanup()
  mounts.length = 0
  unmounts.length = 0
})

describe('KeptThreadViews', () => {
  it('shows a released thread again without remounting its conversation', () => {
    const kept = new KeptThreadViews()
    const view = render(<Panels kept={kept} shown={['a']} />)
    view.rerender(<Panels kept={kept} shown={['b']} />)
    view.rerender(<Panels kept={kept} shown={['a']} />)

    expect(mounts).toEqual(['a', 'b'])
    expect(unmounts).toEqual([])
    expect(document.querySelector('[data-panel="a"] [data-conversation="a"]')).not.toBeNull()
  })

  it('keeps released views out of the document, so only the shown thread is on screen', () => {
    const kept = new KeptThreadViews()
    const view = render(<Panels kept={kept} shown={['a']} />)
    view.rerender(<Panels kept={kept} shown={['b']} />)

    expect([...document.querySelectorAll('[data-conversation]')].map(element => element.getAttribute('data-conversation'))).toEqual(['b'])
    expect(kept.size).toBe(2)
  })

  it('unmounts the least recently released view past the limit', () => {
    const kept = new KeptThreadViews(2)
    const view = render(<Panels kept={kept} shown={['a']} />)
    for (const sessionId of ['b', 'c', 'd']) view.rerender(<Panels kept={kept} shown={[sessionId]} />)

    expect(unmounts).toEqual(['a'])
    expect(kept.size).toBe(3)
    view.rerender(<Panels kept={kept} shown={['a']} />)
    expect(mounts).toEqual(['a', 'b', 'c', 'd', 'a'])
    expect(unmounts).toEqual(['a', 'b'])
  })

  it('restores the scroll offset the reader left when the view comes back', async () => {
    const kept = new KeptThreadViews()
    const view = render(<Panels kept={kept} shown={['a']} />)
    const scroller = document.querySelector<HTMLElement>('[data-scroller="a"]')
    if (scroller === null) throw new Error('missing scroller')
    act(() => {
      scroller.scrollTop = 480
      scroller.dispatchEvent(new Event('scroll'))
    })
    view.rerender(<Panels kept={kept} shown={['b']} />)
    // Detaching a node loses its scroll offset in a browser; emulate that here.
    scroller.scrollTop = 0
    view.rerender(<Panels kept={kept} shown={['a']} />)
    await new Promise(resolve => requestAnimationFrame(resolve))

    expect(scroller.scrollTop).toBe(480)
  })

  it('announces a view shown again, since its components do not remount to take focus', async () => {
    const kept = new KeptThreadViews()
    const shown: (string | null)[] = []
    const listen = (event: Event): void => {
      shown.push(event.target instanceof Element ? (event.target.querySelector('[data-conversation]')?.getAttribute('data-conversation') ?? null) : null)
    }
    document.addEventListener(KeptThreadViews.shownEvent, listen)
    const view = render(<Panels kept={kept} shown={['a']} />)
    view.rerender(<Panels kept={kept} shown={['b']} />)
    view.rerender(<Panels kept={kept} shown={['a']} />)
    await new Promise(resolve => requestAnimationFrame(resolve))
    document.removeEventListener(KeptThreadViews.shownEvent, listen)

    expect(shown).toEqual(['a'])
  })

  it('renders a second panel for an already shown thread on its own', () => {
    const twice = new KeptThreadViews()
    render(
      <>
        <twice.Host />
        <section data-panel="first">
          <twice.Outlet sessionId="a" render={() => <Conversation sessionId="a" />} />
        </section>
        <section data-panel="second">
          <twice.Outlet sessionId="a" render={() => <Conversation sessionId="a" />} />
        </section>
      </>,
    )

    expect(document.querySelectorAll('[data-conversation="a"]')).toHaveLength(2)
  })
})
