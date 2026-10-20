import type { ServerView } from './api.js'

export class ServerSelectionModel {
  /** Selected servers in the panel's order, ignoring ids the snapshot no longer lists. */
  static selected(input: { readonly servers: readonly ServerView[]; readonly ids: readonly string[] }): ServerView[] {
    const wanted = new Set(input.ids)
    return input.servers.filter(server => wanted.has(server.id))
  }

  /** Only the selected servers an enable (or disable) would actually change. */
  static targets(input: { readonly servers: readonly ServerView[]; readonly ids: readonly string[]; readonly enabled: boolean }): ServerView[] {
    return ServerSelectionModel.selected(input).filter(server => server.enabled !== input.enabled)
  }
}
