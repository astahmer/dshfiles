import type { Context } from '@deepseek-ai/cordis'
import SessionController, { type Config as SessionControllerConfig } from './native/index.ts'

export const inject = SessionController.inject
export const Config = SessionController.Config

/** The native controller is a Cordis Service class; this Loader row hosts it unchanged. */
export const apply = (ctx: Context, config: SessionControllerConfig): void => {
  ctx.plugin(SessionController, config)
}
