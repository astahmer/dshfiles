import {
  isSessionFormatJsonObject,
  SessionFormatError,
} from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { sessionRuntimeBindingSchema } from '@deepseek-ai/dsh-session'
import {
  assertReleasedV4Header,
  restoreReleasedV4Artifact,
} from '@deepseek-ai/dsh-session-format-v3-to-v4'

export const releasedV4Header = (header: SessionFormatHeader): SessionFormatHeader => ({
  version: 4,
  id: header.id,
  createdAt: header.createdAt,
  ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
  isSeeded: header.isSeeded,
  ...(header.origin === undefined ? {} : { origin: header.origin }),
  delegationDepth: header.delegationDepth,
  ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
})

/** Validate the exact native V5 logical header without exposing rejected values. */
export const assertReleasedV5Header: (header: unknown) => asserts header is SessionFormatHeader = (header) => {
  if (!isSessionFormatJsonObject(header) || header['version'] !== 5) {
    throw new SessionFormatError('expected format v5 header')
  }
  const allowed = new Set([
    'version',
    'id',
    'createdAt',
    'cwd',
    'parentSession',
    'isSeeded',
    'origin',
    'delegationDepth',
    'agentPreset',
    'runtimeBinding',
  ])
  const unexpected = Object.keys(header).find(key => !allowed.has(key))
  if (unexpected !== undefined) throw new SessionFormatError(`format v5 header has unexpected field ${unexpected}`)
  const releasedV4Candidate = Object.fromEntries(
    Object.entries(header).filter(([key]) => key !== 'runtimeBinding'),
  )
  assertReleasedV4Header({ ...releasedV4Candidate, version: 4 })
  if (!Object.hasOwn(header, 'runtimeBinding')) return
  if (!sessionRuntimeBindingSchema.safeParse(header['runtimeBinding']).success) {
    throw new SessionFormatError('format v5 header runtimeBinding is invalid')
  }
}

/** Restore V5 artifacts with the unchanged released V4 event rules. */
export const restoreReleasedV5Artifact = (
  artifact: SessionFormatArtifact,
  knownEventTypes: ReadonlySet<string>,
): SessionFormatArtifact => {
  assertReleasedV5Header(artifact.header)
  restoreReleasedV4Artifact(
    { ...artifact, header: releasedV4Header(artifact.header) },
    knownEventTypes,
  )
  return artifact
}
