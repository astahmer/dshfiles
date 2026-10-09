/**
 * The thread sidebar declares a full-width seat above its foot. It is not a
 * dependency of this plugin, so the seat is restated with its published shape;
 * registration waits for the declaration, so the stock sidebar never sees it.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.above': {
      kind: 'list'
      scope: 'root'
      owner: Record<never, never>
    }
  }
}

export {}
