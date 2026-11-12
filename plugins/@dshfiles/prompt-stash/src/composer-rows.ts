/**
 * Saved prompts, recent messages and the prompt history as rows of the composer's More menu (polish pass b:r4et). Picking a row, or the
 * `/prompts` command, sends a request to the prompt library control mounted in that thread's composer, which opens its
 * own popover on the chosen tab. The control stays mounted either way; only its button leaves the bar.
 */
export type PromptLibrarySource = 'saved' | 'recent' | 'history'

const listeners = new Map<string, Set<(source: PromptLibrarySource) => void>>()

export const promptLibraryRequests = {
  send(sessionId: string, source: PromptLibrarySource): void {
    for (const listener of listeners.get(sessionId) ?? []) listener(source)
  },
  on(sessionId: string, listener: (source: PromptLibrarySource) => void): () => void {
    const set = listeners.get(sessionId) ?? new Set()
    set.add(listener)
    listeners.set(sessionId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(sessionId)
    }
  },
}
