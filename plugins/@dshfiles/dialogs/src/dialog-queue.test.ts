import { expect, it } from 'vitest'
import { createDialogQueue } from './dialog-queue.js'

it('closes a select dialog and resolves undefined when its signal aborts', async () => {
  const queue = createDialogQueue()
  const controller = new AbortController()
  const answer = queue.service.select({ title: 'Pick', options: [{ title: 'A', value: 'a' }], signal: controller.signal })
  expect(queue.current.get()?.kind).toBe('select')
  controller.abort()
  await expect(answer).resolves.toBeUndefined()
  expect(queue.current.get()).toBeUndefined()
})
