import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { TurnChangesModel, TurnChangesReadError } from './turn-changes.js'

const attempts = async (status: number): Promise<number> => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: TurnChangesModel.retryRead, retryDelay: 0 } } })
  let calls = 0
  await client
    .fetchQuery({
      queryKey: ['turn', status],
      queryFn: () => {
        calls += 1
        return Promise.reject(new TurnChangesReadError(status))
      },
    })
    .catch(() => undefined)
  return calls
}

describe('TurnChangesModel.retryRead', () => {
  it('takes a 404 as the answer: the Host no longer holds that turn', async () => {
    expect(await attempts(404)).toBe(1)
  })

  it('retries another failed read once', async () => {
    expect(await attempts(500)).toBe(2)
  })
})
