import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Presentation contract implemented by the owned Conversation producer, not a second Session owner. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** Render the original header inside the caller's inherited Session binding. */
    'dshfiles.workbench.conversation-header': {
      scope: 'session-maybe'
      /** Keep the host's top-right tab-row recovery affordance off the original toolbar. */
      props: { readonly reserveHostCorner?: boolean }
      children: {
        'conversation.header': { kind: 'single'; scope: 'session-maybe' }
      }
    }
  }
}
