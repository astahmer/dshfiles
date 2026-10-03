import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Ambient declarations every UI plugin would otherwise restate.
 *
 * A hand-written client entry needs three of these and used to declare each one
 * locally: the `llm/stream` waterfall signature and the locale namespace map.
 * CSS modules are declared in the sibling `css-modules.d.ts`, referenced above. They are declared here once, and a plugin reaches them by
 * importing this module, which is exported from `@dshfiles/dshx/client`.
 *
 * `import '@dshfiles/dshx/client/ambient'` is therefore the whole ceremony.
 */

/**
 * The LLM stream waterfall, declared here because a plugin that resolves
 * `dsh-llm` outside the profile's own tree sees a second module identity for
 * cordis, and the augmentation would otherwise land on an `Events` the plugin
 * never reads. The signature mirrors the installed package exactly.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'llm/stream'(
      this: unknown,
      options: import('@deepseek-ai/dsh-llm').GenerateOptions,
      next: () => AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>,
    ): AsyncIterable<import('@deepseek-ai/dsh-llm').StreamChunk>
  }
}

export {}
