import { Utf8, type Summarizer, type SummaryRequest } from '@dshfiles/optmem-core'

export type FakeSummarizer = Summarizer & { readonly requests: SummaryRequest[]; release(): void }

/**
 * Deterministic stand-in for the compaction model: echoes a squashed prefix of its input within the budget.
 * `overshootAttempts` answers past the budget first; `gated` holds every call until `release()`.
 */
export const createFakeSummarizer = (options: { readonly overshootAttempts?: number; readonly gated?: boolean; readonly failing?: boolean } = {}): FakeSummarizer => {
  const requests: SummaryRequest[] = []
  let release = (): void => {}
  const gate = options.gated ? new Promise<void>(resolve => (release = resolve)) : Promise.resolve()
  return {
    model: 'fake-summarizer',
    requests,
    release: () => release(),
    summarize: async request => {
      requests.push(request)
      await gate
      if (options.failing) throw new Error('summarizer unavailable')
      const body = request.input.map(text => text.replace(/\s+/g, ' ').slice(0, 400)).join(' / ')
      const text = `${request.kind === 'leaf' ? 'L' : 'M'}${request.address}: ${body}`
      if (request.attempt < (options.overshootAttempts ?? 0)) return text.padEnd(request.maxBytes + 64, '~')
      return Utf8.clip(text, request.maxBytes)
    },
  }
}
