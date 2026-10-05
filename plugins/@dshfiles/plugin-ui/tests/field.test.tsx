import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, EmptyState, Field, Notice, Select, TextArea } from '../src/index.js'

afterEach(cleanup)

describe('Field', () => {
  it('associates the label, description, and error with the control', () => {
    render(
      <Field description="Shown in the picker" error="Required" label="Name" required>
        {control => <input {...control} />}
      </Field>,
    )
    const input = screen.getByLabelText(/Name/)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.hasAttribute('required')).toBe(true)
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy.map(id => document.getElementById(id)?.textContent)).toEqual(['Shown in the picker', 'Required'])
  })

  it('omits invalid state when there is no error', () => {
    render(<Field label="Name">{control => <TextArea {...control} />}</Field>)
    const textArea = screen.getByLabelText('Name')
    expect(textArea.hasAttribute('aria-invalid')).toBe(false)
    expect(textArea.hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('Select', () => {
  it('reports the typed option value', () => {
    const onValueChange = vi.fn()
    render(
      <Select
        aria-label="Mode"
        onValueChange={onValueChange}
        options={[
          { value: 'sticky', label: 'Sticky' },
          { value: 'balanced', label: 'Balanced' },
        ]}
        value="sticky"
      />,
    )
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'balanced' } })
    expect(onValueChange).toHaveBeenCalledWith('balanced')
  })
})

describe('Notice and EmptyState', () => {
  it('announces danger notices as alerts and info as status', () => {
    render(
      <>
        <Notice tone="danger">Broken</Notice>
        <Notice>Saved</Notice>
      </>,
    )
    expect(screen.getByRole('alert').textContent).toBe('Broken')
    expect(screen.getByRole('status').textContent).toBe('Saved')
  })

  it('renders its action', () => {
    render(<EmptyState action={<button type="button">Add</button>} title="Nothing yet" />)
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })
})

describe('ConfirmDialog', () => {
  const Harness = (props: { readonly onConfirm: () => void; readonly busy?: boolean }): JSX.Element => {
    const [open, setOpen] = useState(true)
    return (
      <ConfirmDialog
        busy={props.busy}
        cancelLabel="Cancel"
        closeLabel="Close"
        confirmLabel="Delete"
        onCancel={() => setOpen(false)}
        onConfirm={props.onConfirm}
        open={open}
        title="Delete alias?"
        tone="danger"
      />
    )
  }

  it('confirms through the submit action and cancels by closing', () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses both actions while busy', () => {
    const onConfirm = vi.fn()
    render(<Harness busy onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true)
  })
})
