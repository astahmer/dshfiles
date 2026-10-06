/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @deepseek-ai/dsh-api-session-controller/client/sessions/remotes
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-commands/remote'
import type {} from '@deepseek-ai/dsh-subagent/remote'

/** Generated Remote namespaces consumed by the Client Session object layer. */
export type SessionRemotes = Pick<ClientRemote, '$stream' | 'commands' | 'session' | 'subagents'>
