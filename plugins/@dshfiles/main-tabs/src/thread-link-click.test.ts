import { afterEach, describe, expect, it } from 'vitest'
import { installThreadLinkClicks, threadSessionIdOf } from './thread-link-click.js'

const ORIGIN = 'http://127.0.0.1:3080'
const THREAD = 'session-96a0ef74-a22c-4552-af40-9d58795e107a'

const uninstalls: (() => void)[] = []

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall()
  document.body.replaceChildren()
})

const install = (openThread: (sessionId: string) => boolean) => {
  const opened: string[] = []
  const uninstall = installThreadLinkClicks({
    document,
    origin: ORIGIN,
    openThread: sessionId => {
      opened.push(sessionId)
      return openThread(sessionId)
    },
  })
  uninstalls.push(uninstall)
  return opened
}

/** Append an anchor with a nested span and click the span, the way a reader hits a link's text. */
const clickLink = (input: { readonly href: string; readonly modifier?: boolean }): boolean => {
  const anchor = document.createElement('a')
  anchor.setAttribute('href', input.href)
  const label = document.createElement('span')
  label.textContent = 'AA'
  anchor.append(label)
  document.body.append(anchor)
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    metaKey: input.modifier === true,
  })
  label.dispatchEvent(event)
  return event.defaultPrevented
}

describe('threadSessionIdOf', () => {
  it('reads the thread of a same-origin link, absolute or relative', () => {
    expect(threadSessionIdOf({ href: `${ORIGIN}/?thread=${THREAD}`, origin: ORIGIN })).toBe(THREAD)
    expect(threadSessionIdOf({ href: `/?thread=${THREAD}&workspace=work-1`, origin: ORIGIN })).toBe(THREAD)
    expect(threadSessionIdOf({ href: `?thread=${THREAD}`, origin: ORIGIN })).toBe(THREAD)
  })

  it('only claims same-origin http(s) thread destinations', () => {
    expect(threadSessionIdOf({ href: `https://elsewhere.test/?thread=${THREAD}`, origin: ORIGIN })).toBeUndefined()
    expect(threadSessionIdOf({ href: `${ORIGIN}/settings`, origin: ORIGIN })).toBeUndefined()
    expect(threadSessionIdOf({ href: 'dsh-session:abc', origin: ORIGIN })).toBeUndefined()
    expect(threadSessionIdOf({ href: `${ORIGIN}/?thread=abc`, origin: ORIGIN })).toBeUndefined()
    expect(threadSessionIdOf({ href: null, origin: ORIGIN })).toBeUndefined()
  })
})

describe('installThreadLinkClicks', () => {
  it('opens a same-origin thread link in a tab instead of loading it', () => {
    const opened = install(() => true)
    expect(clickLink({ href: `${ORIGIN}/?thread=${THREAD}` })).toBe(true)
    expect(opened).toEqual([THREAD])
  })

  it('opens a relative thread link, as the backlog writes them', () => {
    const opened = install(() => true)
    expect(clickLink({ href: `?thread=${THREAD}` })).toBe(true)
    expect(opened).toEqual([THREAD])
  })

  it('leaves a thread the strip cannot open to the browser', () => {
    const opened = install(() => false)
    expect(clickLink({ href: `${ORIGIN}/?thread=${THREAD}` })).toBe(false)
    expect(opened).toEqual([THREAD])
  })

  it('keeps browser navigation for modified clicks, other origins and non-thread links', () => {
    const opened = install(() => true)
    expect(clickLink({ href: `${ORIGIN}/?thread=${THREAD}`, modifier: true })).toBe(false)
    expect(clickLink({ href: `https://elsewhere.test/?thread=${THREAD}` })).toBe(false)
    expect(clickLink({ href: `${ORIGIN}/settings` })).toBe(false)
    expect(opened).toEqual([])
  })

  it('stops listening after the returned uninstall', () => {
    const opened = install(() => true)
    for (const uninstall of uninstalls.splice(0)) uninstall()
    expect(clickLink({ href: `${ORIGIN}/?thread=${THREAD}` })).toBe(false)
    expect(opened).toEqual([])
  })
})
