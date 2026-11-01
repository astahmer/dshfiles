import * as EffectSchema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import {
  cancelQueuedLandOutputSchema,
  classifyWorkspacesInputSchema,
  classifyWorkspacesOutputSchema,
  destinationInputSchema,
  destinationSchema,
  emptyInputSchema,
  integrationProgressOutputSchema,
  isolatedWorkspaceSchema,
  noFolderOutputSchema,
  ownWorkspaceForInputSchema,
  ownWorkspaceForOutputSchema,
  pathInputSchema,
  projectsOutputSchema,
  provisionInputSchema,
  provisionOutputSchema,
  queuedAtOutputSchema,
  queueLandInputSchema,
  reviewHistoryOutputSchema,
  revisionGraphOutputSchema,
  startedOutputSchema,
  workspaceSyncOutputSchema,
} from '../src/api-effect-schemas.js'
import { strictStandardSchema } from '../src/schema.js'

const schemas = [
  cancelQueuedLandOutputSchema,
  classifyWorkspacesInputSchema,
  classifyWorkspacesOutputSchema,
  destinationInputSchema,
  destinationSchema,
  emptyInputSchema,
  integrationProgressOutputSchema,
  isolatedWorkspaceSchema,
  noFolderOutputSchema,
  ownWorkspaceForInputSchema,
  ownWorkspaceForOutputSchema,
  pathInputSchema,
  projectsOutputSchema,
  provisionInputSchema,
  provisionOutputSchema,
  queuedAtOutputSchema,
  queueLandInputSchema,
  reviewHistoryOutputSchema,
  revisionGraphOutputSchema,
  startedOutputSchema,
  workspaceSyncOutputSchema,
]

describe('jj-integration Effect schemas', () => {
  for (const schema of schemas) {
    it('publishes a strict Standard Schema contract and JSON Schema documents', () => {
      const published = strictStandardSchema(schema)
      expect(published['~standard'].version).toBe(1)
      expect(published['~standard'].vendor).toBe('effect')
      expect(published['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual(expect.any(Object))
      expect(published['~standard'].jsonSchema.output({ target: 'draft-2020-12' })).toEqual(expect.any(Object))
    })
  }

  it('rejects excess properties while decoding API object schemas', async () => {
    const schema = strictStandardSchema(ownWorkspaceForInputSchema)
    expect(EffectSchema.decodeUnknownOption(schema)({ workspaceId: 'workspace-1' })._tag).toBe('Some')
    expect('issues' in (await schema['~standard'].validate({ workspaceId: 'workspace-1', extra: true }))).toBe(true)
  })
})
