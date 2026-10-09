import type { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import type { UsageCard } from './api.js'

/** The model slug the official Codex client sends to draw on Luna Reserve once the included usage is spent. */
export const CODEX_RESERVE_MODEL = 'gpt-reserve'

/**
 * Whether a Codex account should draw on Luna Reserve: an ordinary window is
 * spent and has not reset yet, and the reserve still has some left. A cached
 * card from before a reset therefore stops routing to the reserve on its own.
 */
export const shouldUseLunaReserve = (card: UsageCard | undefined, now: number): boolean => {
  if (card === undefined || card.status !== 'ok') return false
  const spent = card.windows.some(
    window => window.reserve !== true && Math.round(window.percentRemaining) <= 0 && (window.resetsAt === null || window.resetsAt > now),
  )
  return spent && card.windows.some(window => window.reserve === true && Math.round(window.percentRemaining) > 0)
}

type CodexProvider = ReturnType<typeof openaiCodexProvider>

/** Swaps the model on the wire only, so the picker, pins and transcript keep the model the user chose. */
export const withLunaReserve = (input: { readonly upstream: CodexProvider; readonly onReserve: () => boolean }): CodexProvider => {
  const upstream = input.upstream
  const route = <Model extends { readonly id: string }>(model: Model): Model => (input.onReserve() ? { ...model, id: CODEX_RESERVE_MODEL } : model)
  return {
    ...upstream,
    stream: (model, context, options) => upstream.stream(route(model), context, options),
    streamSimple: (model, context, options) => upstream.streamSimple(route(model), context, options),
  }
}
