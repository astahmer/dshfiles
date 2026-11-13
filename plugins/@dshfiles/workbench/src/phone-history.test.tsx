import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneHistoryModel, usePhoneHistoryLayer } from './phone-history.js'

afterEach(cleanup)

describe('PhoneHistoryModel', () => {
  it('pushes when the layer went deeper and pops it when the user went back', () => {
    expect(PhoneHistoryModel.step({ depth: 1, entryDepth: 0, popped: false, ownsEntry: false })).toBe('push')
    expect(PhoneHistoryModel.step({ depth: 1, entryDepth: 0, popped: true, ownsEntry: false })).toBe('pop')
    expect(PhoneHistoryModel.step({ depth: 2, entryDepth: 2, popped: true, ownsEntry: true })).toBe('none')
  })

  it('consumes only an entry the layer pushed itself, and rewrites one another layer pushed', () => {
    expect(PhoneHistoryModel.step({ depth: 0, entryDepth: 1, popped: false, ownsEntry: true })).toBe('back')
    expect(PhoneHistoryModel.step({ depth: 0, entryDepth: 1, popped: true, ownsEntry: true })).toBe('back')
    expect(PhoneHistoryModel.step({ depth: 0, entryDepth: 1, popped: false, ownsEntry: false })).toBe('replace')
  })

  it('reads an untagged layer as the bottom and keeps the other layers when tagging', () => {
    expect(PhoneHistoryModel.entryDepth({ depths: {} }, 'stack')).toBe(0)
    expect(PhoneHistoryModel.entryDepth({ depths: { stack: 2 } }, 'stack')).toBe(2)
    const tagged = PhoneHistoryModel.tag({ entry: { depths: { sheet: 1 }, owner: 'sheet' }, key: 'stack', depth: 1, owner: true })
    expect(tagged).toEqual({ depths: { sheet: 1, stack: 1 }, owner: 'stack' })
    expect(PhoneHistoryModel.owns(tagged, 'stack')).toBe(true)
    expect(PhoneHistoryModel.owns(tagged, 'sheet')).toBe(false)
    // Rewriting another layer's entry keeps its pusher.
    expect(PhoneHistoryModel.tag({ entry: tagged, key: 'sheet', depth: 0, owner: false })).toEqual({ depths: { sheet: 0, stack: 1 }, owner: 'stack' })
  })
})

describe('usePhoneHistoryLayer', () => {
  const Stack = (props: { readonly onDepth: (setDepth: (depth: number) => void) => void; readonly baseUrl: (href: string) => string }): JSX.Element => {
    const [depth, setDepth] = useState(0)
    props.onDepth(setDepth)
    usePhoneHistoryLayer({ key: 'stack', depth, enabled: true, pop: () => setDepth(current => current - 1), baseUrl: props.baseUrl })
    return <output data-depth={depth} />
  }

  it('pushes one entry per level, pops the stack on browser Back and consumes the entry on in-app Back', async () => {
    window.history.replaceState({ router: 'kept' }, '', '/?thread=a')
    let setDepth: (depth: number) => void = () => {}
    const start = window.history.length
    const view = render(<Stack onDepth={set => (setDepth = set)} baseUrl={href => href.replace('?thread=a', '')} />)
    const depth = (): string | null => view.container.querySelector('output')?.getAttribute('data-depth') ?? null
    act(() => setDepth(1))
    expect(window.history.length).toBe(start + 1)
    expect(window.location.search).toBe('?thread=a')
    // State DSH keeps in the entry survives the tag.
    expect(window.history.state?.router).toBe('kept')
    // Browser Back onto the list's entry pops the stack once; the list's entry carries no thread.
    act(() => window.history.back())
    await waitFor(() => expect(depth()).toBe('0'))
    expect(window.location.search).toBe('')
    // Opening again pushes again, replacing the forward entry instead of growing history.
    window.history.replaceState(window.history.state, '', '/?thread=a')
    act(() => setDepth(1))
    expect(window.history.length).toBe(start + 1)
    // The in-app Back consumes the pushed entry without popping the stack a second time.
    act(() => setDepth(0))
    await waitFor(() => expect(window.history.state?.dshfilesPhoneHistory?.depths?.stack ?? 0).toBe(0))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(depth()).toBe('0')
  })
})
