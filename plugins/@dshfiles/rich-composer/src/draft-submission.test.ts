import { describe, expect, it, vi } from 'vitest'
import { submitMaterializedDraft } from './draft-submission.js'

describe('draft submission identity boundary', () => {
  it('waits for creation before workspace intake and attachment routing run', async () => {
    const created = Promise.withResolvers<void>()
    const send = vi.fn(async () => ({ kind: 'success' as const }))
    const sending = submitMaterializedDraft({ signal: new AbortController().signal, whenCreated: () => created.promise, send })
    expect(send).not.toHaveBeenCalled()
    created.resolve()
    await expect(sending).resolves.toEqual({ kind: 'success' })
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not start intake after cancellation or refused creation', async () => {
    const created = Promise.withResolvers<void>()
    const controller = new AbortController()
    const send = vi.fn(async () => ({ kind: 'success' as const }))
    const sending = submitMaterializedDraft({ signal: controller.signal, whenCreated: () => created.promise, send })
    controller.abort(new Error('cancelled draft'))
    created.resolve()
    await expect(sending).rejects.toThrow('cancelled draft')
    expect(send).not.toHaveBeenCalled()
    await expect(
      submitMaterializedDraft({
        signal: new AbortController().signal,
        whenCreated: async () => {
          throw new Error('creation refused')
        },
        send,
      }),
    ).rejects.toThrow('creation refused')
    expect(send).not.toHaveBeenCalled()
  })
})
