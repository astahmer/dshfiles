import type { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from './native/index.ts'

/** The native runtime is a Cordis Service class; this Loader row hosts it unchanged. */
export const apply = (ctx: Context): void => {
  ctx.plugin(LocalSubprocessRuntime)
}
