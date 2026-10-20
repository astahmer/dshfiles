import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineTitleEditor } from '../src/components/ui/inline-title-editor.js'

afterEach(cleanup)

const mount = (options: { readonly value?: string; readonly onCommit?: (title: string) => void; readonly onCancel?: () => void } = {}) => {
  const onCommit = options.onCommit ?? vi.fn()
  const onCancel = options.onCancel ?? vi.fn()
  render(<InlineTitleEditor value={options.value ?? 'Thread title'} label="Rename thread" onCommit={onCommit} onCancel={onCancel} />)
  return { onCommit, onCancel, input: screen.getByRole('textbox', { name: 'Rename thread' }) }
}

describe('InlineTitleEditor', () => {
  it('commits a changed title on Enter', () => {
    const { input, onCommit } = mount()
    fireEvent.change(input, { target: { value: '  Renamed thread  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('Renamed thread')
  })

  it('cancels on Escape without committing', () => {
    const { input, onCommit, onCancel } = mount()
    fireEvent.change(input, { target: { value: 'Renamed thread' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('cancels an unchanged or blank title', () => {
    const unchanged = mount()
    fireEvent.keyDown(unchanged.input, { key: 'Enter' })
    expect(unchanged.onCancel).toHaveBeenCalledOnce()
    expect(unchanged.onCommit).not.toHaveBeenCalled()
    cleanup()

    const blank = mount()
    fireEvent.change(blank.input, { target: { value: '   ' } })
    fireEvent.keyDown(blank.input, { key: 'Enter' })
    expect(blank.onCancel).toHaveBeenCalledOnce()
    expect(blank.onCommit).not.toHaveBeenCalled()
  })

  it('commits on a later blur but ignores the focus restore that follows a menu', () => {
    vi.useFakeTimers()
    try {
      const { input, onCommit } = mount()
      fireEvent.change(input, { target: { value: 'Renamed thread' } })
      fireEvent.blur(input)
      expect(onCommit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(200)
      fireEvent.blur(input)
      expect(onCommit).toHaveBeenCalledWith('Renamed thread')
    } finally {
      vi.useRealTimers()
    }
  })
})
