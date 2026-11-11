import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * The renderer keeps a Session's store instance for its whole Context generation, which outlives a retired Sidebar
 * view while the conversation still holds the Session. An open that finds no adoption must re-adopt that rendered
 * instance: a fresh one would take the tab while the seat keeps rendering the old one, an empty Workbench panel.
 * @param input - the store factory and the adoption that binds an instance to the controller.
 * @returns the renderer's `create`, the controller's `mint`, and `forget` for a cleared Session.
 */
export const createRenderedStores = <Instance>(input: {
  readonly create: (sessionId: SessionId) => Instance
  readonly bind: (sessionId: SessionId, instance: Instance) => void
}) => {
  const rendered = new Map<SessionId, Instance>()
  const create = (sessionId: SessionId): Instance => {
    const instance = input.create(sessionId)
    rendered.set(sessionId, instance)
    input.bind(sessionId, instance)
    return instance
  }
  return {
    create,
    mint: (sessionId: SessionId): void => {
      const kept = rendered.get(sessionId)
      if (kept === undefined) create(sessionId)
      else input.bind(sessionId, kept)
    },
    forget: (sessionId: SessionId): void => {
      rendered.delete(sessionId)
    },
  }
}
