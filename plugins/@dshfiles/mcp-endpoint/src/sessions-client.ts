import type { Context } from '@deepseek-ai/cordis'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'

export const createSessionsClient = (ctx: Context) => createHostApiClient(ctx, sessionsApi, '@dshfiles/mcp-endpoint')

export type SessionsClient = ReturnType<typeof createSessionsClient>
