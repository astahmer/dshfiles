import * as EffectSchema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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

/** The normalization `scripts/effect-schema-parity.mjs` applies: drop the dialect markers, fold `const` into `enum`, sort keys. */
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value).filter(
    ([key, child]) => key !== '$schema' && !(key === 'definitions' && Object.keys(child).length === 0) && key !== 'dialect',
  )
  const normalized = Object.fromEntries(entries.map(([key, child]) => [key, normalize(child)]))
  if ('const' in normalized) {
    const constant = normalized.const
    delete normalized.const
    normalized.enum = [constant]
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)))
}

/** dshx drops `additionalProperties: true` before publishing, so the comparison does the same. */
const omitDefaultAdditionalProperties = value => {
  if (Array.isArray(value)) return value.map(omitDefaultAdditionalProperties)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === 'additionalProperties' && child === true))
      .map(([key, child]) => [key, omitDefaultAdditionalProperties(child)]),
  )
}

const zodDocument = (schema, io) => normalize(schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' }))
const zodRawDocument = (schema, io) => schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })
const effectRawDocument = (schema, io) =>
  omitDefaultAdditionalProperties(strictStandardSchema(schema)['~standard'].jsonSchema[io]({ target: 'draft-2020-12' }))

const effectDocument = (schema, io) =>
  normalize(omitDefaultAdditionalProperties(strictStandardSchema(schema)['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })))

const nonEmpty = z.string().min(1)
const threadWorkspaceName = z.string().regex(/^thread-[0-9a-f]{6}$/u)
const count = z.number().int().nonnegative()

const zodDestination = z
  .object({
    vcs: z.enum(['jj', 'none']),
    isolated: z.boolean(),
    projectWorkspaceId: z.string().nullable(),
    bookmark: z.string().nullable(),
    bookmarks: z.array(z.string()),
    isolateByDefault: z.boolean(),
    ownedByAnotherSession: z.boolean().optional(),
  })
  .strict()

const zodIntegrationProgress = z.object({ phase: z.enum(['queued', 'validating', 'rebasing']), updatedAt: count }).strict()

const zodWorkspaceSync = z
  .object({
    state: z.enum(['running', 'done', 'failed']),
    workspace: z.string(),
    bookmark: z.string(),
    status: z.enum(['up-to-date', 'synced', 'would-sync', 'refused', 'conflicted', 'build-failed']).nullable(),
    pluginsRebuilt: z.array(z.string()),
    hotPlugins: z.array(z.string()),
    restartNeeded: z.boolean(),
    conflicts: z.array(z.string()),
    message: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .strict()

const zodRegisteredProject = z.object({ workspaceId: z.string(), title: z.string(), path: z.string() }).strict()

const destination = {
  vcs: 'jj',
  isolated: true,
  projectWorkspaceId: 'workspace-1',
  bookmark: 'main',
  bookmarks: ['main', 'effect/4.1-migration'],
  isolateByDefault: true,
}

const integrationProgress = { phase: 'rebasing', updatedAt: 1_234 }

const workspaceSync = {
  state: 'done',
  workspace: '/tmp/thread-30fcf4',
  bookmark: 'main',
  status: 'synced',
  pluginsRebuilt: ['@dshfiles/jj-integration'],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message: null,
  finishedAt: null,
}

const fixtures = [
  {
    name: 'own workspace for input',
    zod: z.object({ workspaceId: nonEmpty }).strict(),
    effect: ownWorkspaceForInputSchema,
    input: { workspaceId: 'workspace-1' },
  },
  {
    name: 'own workspace for output',
    zod: z.object({ workspaceId: z.string(), branched: z.boolean() }).strict(),
    effect: ownWorkspaceForOutputSchema,
    input: { workspaceId: 'workspace-1', branched: false },
  },
  {
    name: 'provision input',
    zod: z
      .object({
        workspaceId: nonEmpty,
        isolate: z.boolean().optional(),
        base: z.string().min(1).max(256).optional(),
        name: threadWorkspaceName.optional(),
      })
      .strict(),
    effect: provisionInputSchema,
    input: { workspaceId: 'workspace-1', isolate: true, name: 'thread-30fcf4' },
  },
  {
    name: 'provision output',
    zod: z.object({ workspaceId: z.string(), isolated: z.boolean(), destination: zodDestination.optional() }).strict(),
    effect: provisionOutputSchema,
    input: { workspaceId: 'workspace-1', isolated: true, destination },
  },
  {
    name: 'destination input',
    zod: z.object({ workspaceId: nonEmpty, sessionId: nonEmpty.optional() }).strict(),
    effect: destinationInputSchema,
    input: { workspaceId: 'workspace-1', sessionId: 'session-1' },
  },
  { name: 'destination output', zod: zodDestination, effect: destinationSchema, input: destination },
  {
    name: 'classify workspaces input',
    zod: z.object({ workspaceIds: z.array(z.string().min(1).max(256)).max(256) }).strict(),
    effect: classifyWorkspacesInputSchema,
    input: { workspaceIds: ['workspace-1'] },
  },
  {
    name: 'classify workspaces output',
    zod: z.object({ jjWorkspaceIds: z.array(z.string().min(1).max(256)).max(256) }).strict(),
    effect: classifyWorkspacesOutputSchema,
    input: { jjWorkspaceIds: ['workspace-1'] },
  },
  { name: 'projects input', zod: z.object({}).strict(), effect: emptyInputSchema, input: {} },
  {
    name: 'projects output',
    zod: z.object({ projects: z.array(zodRegisteredProject), workspaces: z.array(zodRegisteredProject).optional() }).strict(),
    effect: projectsOutputSchema,
    input: { projects: [{ workspaceId: 'workspace-1', title: 'dshfiles', path: '/Users/astahmer/dev/dshfiles' }] },
  },
  { name: 'no folder output', zod: z.object({ workspaceId: z.string() }).strict(), effect: noFolderOutputSchema, input: { workspaceId: 'workspace-1' } },
  { name: 'started output', zod: z.object({ started: z.boolean() }).strict(), effect: startedOutputSchema, input: { started: true } },
  { name: 'revision graph input', zod: z.object({ path: nonEmpty }).strict(), effect: pathInputSchema, input: { path: '/tmp/thread-30fcf4' } },
  { name: 'revision graph output', zod: z.object({ graph: z.string().max(16_000) }).strict(), effect: revisionGraphOutputSchema, input: { graph: '@' } },
  {
    name: 'isolate output',
    zod: z.object({ name: nonEmpty, path: nonEmpty, created: z.boolean() }).strict(),
    effect: isolatedWorkspaceSchema,
    input: { name: 'thread-30fcf4', path: '/tmp/thread-30fcf4', created: true },
  },
  {
    name: 'queue land input',
    zod: z.object({ path: nonEmpty, sessionId: z.string().optional() }).strict(),
    effect: queueLandInputSchema,
    input: { path: '/tmp/thread-30fcf4', sessionId: 'session-1' },
  },
  { name: 'queued at output', zod: z.object({ queuedAt: count }).strict(), effect: queuedAtOutputSchema, input: { queuedAt: 1_234 } },
  {
    name: 'cancel queued land output',
    zod: z.object({ status: z.enum(['cancelled', 'not-queued', 'integrating']) }).strict(),
    effect: cancelQueuedLandOutputSchema,
    input: { status: 'cancelled' },
  },
  {
    name: 'integration progress output',
    zod: z.object({ progress: zodIntegrationProgress.nullable() }).strict(),
    effect: integrationProgressOutputSchema,
    input: { progress: integrationProgress },
  },
  {
    name: 'review history output',
    zod: z
      .object({
        repoRoot: nonEmpty,
        name: threadWorkspaceName,
        integrations: z.array(
          z
            .object({
              at: count,
              tipChangeId: z.string().min(1).max(128).optional(),
              baseChangeId: z.string().min(1).max(128).optional(),
              sessionId: z.string().min(1).max(128).optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    effect: reviewHistoryOutputSchema,
    input: { repoRoot: '/Users/astahmer/dev/dshfiles', name: 'thread-30fcf4', integrations: [{ at: 1_234, tipChangeId: 'abc' }] },
  },
  {
    name: 'workspace sync output',
    zod: z.object({ sync: zodWorkspaceSync.nullable() }).strict(),
    effect: workspaceSyncOutputSchema,
    input: { sync: workspaceSync },
  },
]

describe('jj-integration Effect schema parity', () => {
  for (const fixture of fixtures) {
    it(`publishes the same JSON Schema as zod for ${fixture.name}`, () => {
      expect(effectDocument(fixture.effect, 'input')).toEqual(zodDocument(fixture.zod, 'input'))
      expect(effectDocument(fixture.effect, 'output')).toEqual(zodDocument(fixture.zod, 'output'))
    })

    it(`publishes byte-identical JSON Schema text for ${fixture.name}`, () => {
      expect(JSON.stringify(effectRawDocument(fixture.effect, 'input'))).toBe(JSON.stringify(zodRawDocument(fixture.zod, 'input')))
      expect(JSON.stringify(effectRawDocument(fixture.effect, 'output'))).toBe(JSON.stringify(zodRawDocument(fixture.zod, 'output')))
    })

    it(`decodes the same values as zod for ${fixture.name}`, () => {
      const zodResult = fixture.zod.safeParse(fixture.input)
      const effectResult = EffectSchema.decodeUnknownOption(fixture.effect)(fixture.input)
      expect(zodResult.success).toBe(true)
      expect(effectResult._tag).toBe('Some')
      expect(effectResult._tag === 'Some' ? effectResult.value : undefined).toEqual(zodResult.success ? zodResult.data : undefined)
    })
  }
})
