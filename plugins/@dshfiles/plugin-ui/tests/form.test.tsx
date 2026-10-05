import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { useAppForm } from '../src/form.js'

afterEach(cleanup)

const schema = z.object({ name: z.string().min(1, 'Name is required'), transport: z.enum(['stdio', 'http']) })

const ServerForm = (props: { readonly onSubmit: (value: z.infer<typeof schema>) => void }): JSX.Element => {
  const defaultValues: z.infer<typeof schema> = { name: '', transport: 'stdio' }
  const form = useAppForm({
    defaultValues,
    validators: { onChange: schema },
    onSubmit: ({ value }) => props.onSubmit(value),
  })
  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="name">{field => <field.TextField label="Name" />}</form.AppField>
      <form.AppField name="transport">
        {field => (
          <field.SelectField
            label="Transport"
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'http', label: 'HTTP' },
            ]}
          />
        )}
      </form.AppField>
      <form.AppForm>
        <form.SubmitButton>Save</form.SubmitButton>
      </form.AppForm>
    </form>
  )
}

describe('useAppForm', () => {
  it('shows schema errors after submission and submits valid values', async () => {
    const onSubmit = vi.fn()
    render(<ServerForm onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Name is required'))
    expect(screen.getByLabelText(/Name/).getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'github' } })
    fireEvent.change(screen.getByLabelText('Transport'), { target: { value: 'http' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'github', transport: 'http' }))
  })
})
