import type { SessionId as CoreSessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId as CoreWorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Schema } from 'effect'

/** The DSH core Session id brand, so a decoded value passes straight into core APIs without a re-brand. */
export type SessionId = CoreSessionId

/** The DSH core Workspace id brand. */
export type WorkspaceId = CoreWorkspaceId

const MAX_ID_LENGTH = 256

const isSessionId = (value: string): value is SessionId => value.length > 0 && value.length <= MAX_ID_LENGTH

const isWorkspaceId = (value: string): value is WorkspaceId => value.length > 0 && value.length <= MAX_ID_LENGTH

/** A non-empty Session id carrying core's `SessionId` brand; encodes back to the plain string. */
export const SessionId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ID_LENGTH)).pipe(
  Schema.refine(isSessionId, { identifier: 'SessionId', expected: 'a DSH Session id' }),
)

/** A non-empty Workspace id carrying core's `WorkspaceId` brand; encodes back to the plain string. */
export const WorkspaceId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ID_LENGTH)).pipe(
  Schema.refine(isWorkspaceId, { identifier: 'WorkspaceId', expected: 'a DSH Workspace id' }),
)
