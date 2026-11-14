import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { changesSummaryUrl } from '../src/changes.ts'
import { ChangesSummaryStore } from '../src/native/changes-summary.ts'
import { handleChangesSummary } from '../src/present-open.ts'

const sessionId = SessionId('session-historical')
const summaryRequest = (seq = '626') => new Request(`http://host/api/changes.summary?sessionId=${sessionId}&seq=${seq}`)

/** A Host whose in-memory recorder no longer holds the announced summary (for example after a restart). */
const expiredHost = { workspaceChanges: { summary: () => undefined, diff: async () => undefined } }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('changes.summary on the Host', () => {
  it('answers 204 No Content once the summary expired, so the browser logs no failed request', async () => {
    const response = handleChangesSummary(expiredHost, summaryRequest())
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it('still rejects invalid coordinates', () => {
    expect(handleChangesSummary(expiredHost, summaryRequest('-1')).status).toBe(400)
  })

  it('serves a live summary without its workspace path', async () => {
    const liveHost = {
      workspaceChanges: {
        summary: () => ({ turn: 6, cwd: '/private/workspace', files: [], total: 0, added: 0, deleted: 0 }),
        diff: async () => undefined,
      },
    }
    const response = handleChangesSummary(liveHost, summaryRequest())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ turn: 6, files: [], total: 0, added: 0, deleted: 0 })
  })
})

describe('changes.summary in the browser store', () => {
  it('records 204 as missing without parsing it and without asking again', async () => {
    let requests = 0
    let parsed = false
    vi.stubGlobal('fetch', async () => {
      requests += 1
      return Object.assign(new Response(null, { status: 204 }), {
        json: async (): Promise<never> => {
          parsed = true
          throw new SyntaxError('a 204 answer has no body to parse')
        },
      })
    })
    const store = new ChangesSummaryStore()
    await store.load(sessionId, 626)
    await store.load(sessionId, 626)
    expect(store.state.getSnapshot()[changesSummaryUrl(sessionId, 626)]).toBe('missing')
    expect(requests).toBe(1)
    expect(parsed).toBe(false)
    await store.dispose()
  })
})
