// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { DeleteReplyButton, replyExcerpt } from './delete-reply.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})

test('deleting a reply asks in the kit dialog, naming the reply, never the browser confirm', () => {
  const confirm = vi.spyOn(window, 'confirm')
  const onDelete = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<DeleteReplyButton text={'Ship it\nafter review'} onDelete={onDelete} />))
  act(() => host?.querySelector<HTMLButtonElement>('button[aria-label="Delete reply"]')?.click())
  const dialog = document.querySelector('[role="alertdialog"]')
  expect(dialog?.textContent).toContain('“Ship it after review”')
  expect(dialog?.textContent).toContain('The item and its other replies stay.')
  expect(onDelete).not.toHaveBeenCalled()
  const confirmButton = [...(dialog?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Delete reply')
  act(() => confirmButton?.click())
  expect(onDelete).toHaveBeenCalledOnce()
  expect(confirm).not.toHaveBeenCalled()
})

test('a long reply is named by its first words', () => {
  expect(replyExcerpt('a'.repeat(200))).toHaveLength(80)
})
