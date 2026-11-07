import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'
import type { ApiSchema } from '@dshfiles/dshx/api'
import { multiHostApi, resourceSnapshotSchema } from './api.js'

/** Decode unknown input with Effect Schema's own defaults (excess properties ignored). */
const decodeLoose = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) => {
  const result = Schema.decodeUnknownResult(schema)(input)
  return result._tag === 'Success' ? { success: true as const, data: result.success } : { success: false as const, error: new Error(result.failure.message) }
}

const isEffectSchema = (schema: ApiSchema): schema is Schema.ConstraintDecoder<unknown> => 'ast' in schema

/** The strict boundary dshx publishes for a contract schema, which is what a client and a tool both see. */
const standard = (schema: ApiSchema) => {
  if ('~standard' in schema) return schema['~standard']
  if (!isEffectSchema(schema)) throw new Error('The API schema must expose Standard Schema validation.')
  const boundary = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })['~standard']
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })
  return {
    ...boundary,
    jsonSchema: {
      ...jsonSchema,
      input: (options: { readonly target: 'draft-2020-12' }) => {
        const published = jsonSchema.input(options)
        return { ...published, ...document.schema }
      },
    },
  }
}

type JsonSchemaDocument = Record<string, unknown>
type JsonSchemaInput = (options: { readonly target: 'draft-2020-12' }) => object
type JsonSchemaConverter = { readonly input: JsonSchemaInput }

const isRecord = (value: unknown): value is JsonSchemaDocument => typeof value === 'object' && value !== null && !Array.isArray(value)

const isJsonSchemaConverter = (value: unknown): value is JsonSchemaConverter =>
  typeof value === 'object' && value !== null && 'input' in value && typeof value.input === 'function'

const jsonSchemaInput = (boundary: ReturnType<typeof standard>): ((options: { readonly target: 'draft-2020-12' }) => JsonSchemaDocument) => {
  if (!('jsonSchema' in boundary)) throw new Error('The schema boundary must expose its JSON Schema converter.')
  const converter = boundary.jsonSchema
  if (!isJsonSchemaConverter(converter)) throw new Error('The schema boundary must expose its JSON Schema converter.')
  return options => {
    const document = converter.input(options)
    if (!isRecord(document)) throw new Error('JSON Schema input must be an object document.')
    return document
  }
}

describe('multi-host tool exposure', () => {
  test('every remote/host action a human can take is a named tool', () => {
    const tools = Object.values(multiHostApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'multi_host_answer_question',
      'multi_host_browse',
      'multi_host_checkout_sync',
      'multi_host_clone_project',
      'multi_host_create_thread',
      'multi_host_delegate',
      'multi_host_doctor',
      'multi_host_exec',
      'multi_host_file_references',
      'multi_host_find_homes',
      'multi_host_forget_thread',
      'multi_host_identity',
      'multi_host_list',
      'multi_host_local_project_files',
      'multi_host_mkdir',
      'multi_host_models',
      'multi_host_open_folder',
      'multi_host_project_origins',
      'multi_host_provision',
      'multi_host_reconnect',
      'multi_host_remove_host',
      'multi_host_remove_runtime',
      'multi_host_reorder_hosts',
      'multi_host_resource_pool',
      'multi_host_resource_snapshot',
      'multi_host_runtime_control',
      'multi_host_runtime_logs',
      'multi_host_runtime_status',
      'multi_host_save_ssh_host',
      'multi_host_session_interactions',
      'multi_host_session_jj',
      'multi_host_session_jj_repositories',
      'multi_host_session_repository',
      'multi_host_set_host_hidden',
      'multi_host_set_host_settings',
      'multi_host_ssh_hosts',
      'multi_host_start_thread',
      'multi_host_status',
      'multi_host_test',
      'multi_host_thread_reply',
      'multi_host_thread_stop',
      'multi_host_thread_transcript',
      'multi_host_threads',
      'multi_host_update',
    ])
  })

  test('project origin lookup bounds local and remote path batches', async () => {
    const inputSchema = multiHostApi.methods.projectOrigins.input
    if (inputSchema === undefined) throw new Error('The project origin API must define an input schema.')
    const accepts = async (input: unknown): Promise<boolean> => {
      const result = await standard(inputSchema).validate(input)
      return !('issues' in result)
    }
    expect(await accepts({ localPaths: ['/work/local'], remote: [{ runtimeId: 'runtime-a', paths: ['/work/remote'] }] })).toBe(true)
    expect(await accepts({ localPaths: ['/work/with\t-tab'], remote: [] })).toBe(false)
    expect(await accepts({ localPaths: new Array(201).fill('/work/local'), remote: [] })).toBe(false)
    expect(await accepts({ localPaths: [], remote: new Array(65).fill({ runtimeId: 'runtime-a', paths: [] }) })).toBe(false)
    expect(await accepts({ localPaths: [], remote: [{ runtimeId: 'runtime-a', paths: new Array(201).fill('/work/remote') }] })).toBe(false)
  })

  test('remote cloning accepts safe destinations and complete local-file selections', async () => {
    const inputSchema = multiHostApi.methods.runtimeCloneProject.input
    if (inputSchema === undefined) throw new Error('The remote clone API must define an input schema.')
    const accepts = async (repositoryUrl: string, destinationPath: string): Promise<boolean> => {
      const result = await standard(inputSchema).validate({ runtimeId: 'runtime', repositoryUrl, destinationPath })
      return !('issues' in result)
    }
    expect(await accepts('https://github.com/owner/repo.git', '~/repo')).toBe(true)
    expect(await accepts('git@github.com:owner/repo.git', '/home/user/repo')).toBe(true)
    expect(await accepts('file:///etc/passwd', '/home/user/repo')).toBe(false)
    expect(await accepts('https://github.com/owner/repo.git; touch /tmp/pwned', '/home/user/repo')).toBe(false)
    expect(await accepts('https://github.com/owner/repo.git', '~/../outside')).toBe(false)
    const cloneInput = multiHostApi.methods.runtimeCloneProject.input
    if (cloneInput === undefined) throw new Error('The remote clone API must define an input schema.')
    const copyInput = {
      runtimeId: 'runtime',
      repositoryUrl: 'https://github.com/owner/repo.git',
      destinationPath: '~/repo',
      copyFromPath: '/work/project',
      copyPaths: ['.env.example', 'notes.txt'],
    }
    expect('issues' in (await standard(cloneInput).validate(copyInput))).toBe(false)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, includeIgnored: true }))).toBe(false)
    expect(
      'issues' in
        (await standard(cloneInput).validate({
          runtimeId: 'runtime',
          repositoryUrl: copyInput.repositoryUrl,
          destinationPath: '~/repo',
          includeIgnored: true,
        })),
    ).toBe(true)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, copyPaths: ['../outside'] }))).toBe(true)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, copyPaths: ['bad\0path'] }))).toBe(true)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, copyPaths: undefined }))).toBe(true)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, copyFromPath: undefined }))).toBe(true)
    expect('issues' in (await standard(cloneInput).validate({ ...copyInput, unexpected: true }))).toBe(true)
    const scanInput = multiHostApi.methods.localProjectFiles.input
    if (scanInput === undefined) throw new Error('The local project file scan must define an input schema.')
    expect('issues' in (await standard(scanInput).validate({ path: '/work/project' }))).toBe(false)
    expect('issues' in (await standard(scanInput).validate({ path: '/work/project', includeIgnored: true }))).toBe(false)
    expect('issues' in (await standard(scanInput).validate({ path: '/work/project', includeIgnored: 'yes' }))).toBe(true)
  })

  test('publishes strict clone input JSON Schema through the Standard Schema boundary', () => {
    const input = multiHostApi.methods.runtimeCloneProject.input
    if (input === undefined) throw new Error('The remote clone API must define an input schema.')
    const boundary: unknown = standard(input)
    if (typeof boundary !== 'object' || boundary === null || !('jsonSchema' in boundary)) {
      throw new Error('The remote clone input must publish Standard JSON Schema.')
    }
    const jsonSchema = boundary.jsonSchema
    if (typeof jsonSchema !== 'object' || jsonSchema === null || !('input' in jsonSchema) || typeof jsonSchema.input !== 'function') {
      throw new Error('The remote clone input must publish Standard JSON Schema.')
    }

    const document = jsonSchema.input({ target: 'draft-2020-12' })
    expect(document).toMatchObject({
      properties: {
        copyFromPath: { type: 'string', minLength: 1, maxLength: 4096 },
        repositoryUrl: { type: 'string', maxLength: 2048, pattern: expect.any(String) },
      },
      required: ['runtimeId', 'repositoryUrl', 'destinationPath'],
      additionalProperties: false,
    })
    expect(document.properties.destinationPath).toMatchObject({
      anyOf: [
        { type: 'string', minLength: 2, maxLength: 4096, pattern: expect.any(String) },
        { type: 'string', minLength: 3, maxLength: 4096, pattern: expect.any(String) },
      ],
    })
  })

  test('no-argument methods accept the undefined input the browser client sends', async () => {
    const methods = [multiHostApi.methods.list, multiHostApi.methods.threadList, multiHostApi.methods.resourcePool]
    for (const method of methods) {
      if (method.input === undefined) throw new Error('A no-argument method still declares its Void input.')
      expect('issues' in (await standard(method.input).validate(undefined))).toBe(false)
    }
  })

  test('session ID tools validate strictly and publish their input JSON Schema', async () => {
    const inputs: { readonly schema: ApiSchema | undefined; readonly valid: Readonly<Record<string, unknown>> }[] = [
      { schema: multiHostApi.methods.sessionJjRepositories.input, valid: { sessionId: 'session-1' } },
      {
        schema: multiHostApi.methods.runtimeFileReferences.input,
        valid: { runtimeId: 'runtime-1', sessionId: 'session-1', query: 'src/' },
      },
    ]

    for (const { schema, valid } of inputs) {
      if (schema === undefined) throw new Error('The session API must define an input schema.')
      const boundary = standard(schema)
      const inputJsonSchema = jsonSchemaInput(boundary)
      expect(inputJsonSchema({ target: 'draft-2020-12' })).toMatchObject({
        properties: { sessionId: { type: 'string', minLength: 1, maxLength: 256 } },
        additionalProperties: false,
      })
      expect('issues' in (await boundary.validate(valid))).toBe(false)
      expect('issues' in (await boundary.validate({ ...valid, sessionId: '' }))).toBe(true)
      expect('issues' in (await boundary.validate({ ...valid, extra: true }))).toBe(true)
    }
  })

  test('thread start publishes its closed nested model schema', async () => {
    const input = multiHostApi.methods.threadStart.input
    if (input === undefined) throw new Error('The remote thread start API must define an input schema.')
    const boundary = standard(input)
    const inputJsonSchema = jsonSchemaInput(boundary)
    const document = inputJsonSchema({ target: 'draft-2020-12' })
    expect(document).toMatchObject({
      properties: {
        model: {
          anyOf: [{ type: 'object', required: ['provider', 'model'], additionalProperties: false }, { type: 'null' }],
        },
      },
      additionalProperties: false,
    })

    const valid = {
      runtimeId: 'runtime-1',
      cwd: '/work/project',
      text: ' hello ',
      model: { provider: 'deepseek', model: 'chat' },
    }
    const parsed = await boundary.validate(valid)
    if ('issues' in parsed) throw new Error('The nested model input was rejected.')
    expect(parsed.value).toEqual({
      runtimeId: 'runtime-1',
      cwd: '/work/project',
      text: 'hello',
      model: { provider: 'deepseek', model: 'chat' },
    })
    expect('issues' in (await boundary.validate({ ...valid, model: { ...valid.model, extra: true } }))).toBe(true)
    expect('issues' in (await boundary.validate({ ...valid, rootExtra: true }))).toBe(true)
  })

  test('remote model results preserve reasoning choices', async () => {
    const outputSchema = multiHostApi.methods.runtimeModels.output
    if (outputSchema === undefined) throw new Error('The remote model catalog API must define an output schema.')
    const validation = await standard(outputSchema).validate({
      ok: true,
      default: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' },
      routableProviders: ['deepseek'],
      groups: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            {
              id: 'chat',
              name: 'Chat',
              reasoning: { efforts: [{ id: 'high', name: 'High', description: 'More deliberate.' }], defaultEffort: 'high' },
            },
          ],
        },
      ],
      failures: [],
    })
    if ('issues' in validation) throw new Error('The remote model catalog output was rejected.')
    expect(validation.value).toMatchObject({
      ok: true,
      groups: [{ models: [{ reasoning: { efforts: [{ id: 'high' }] } }] }],
    })
  })

  test('resource snapshots reject impossible machine metrics', () => {
    const snapshot = {
      sampledAt: '2026-10-28T05:00:00.000Z',
      platform: 'linux',
      cpuCount: 8,
      loadAverage1m: 1.25,
      memoryTotalBytes: 100,
      memoryFreeBytes: 60,
    }

    expect(decodeLoose(resourceSnapshotSchema, snapshot).success).toBe(true)
    expect(decodeLoose(resourceSnapshotSchema, { ...snapshot, memoryFreeBytes: 101 }).success).toBe(false)
    expect(decodeLoose(resourceSnapshotSchema, { ...snapshot, loadAverage1m: -1 }).success).toBe(false)
  })

  test('the remote JJ repository proxy validates bounded read-only data', async () => {
    const outputSchema = multiHostApi.methods.sessionJjRepositories.output
    if (outputSchema === undefined) throw new Error('The remote JJ repository API must define an output schema.')
    // The contract boundary is strict, so a newer field a remote runtime sends is refused rather than silently kept;
    // decoding the same payload with the schema alone is what tolerates it.
    const valid = await standard(outputSchema).validate({
      ok: true,
      repositories: { repositories: [{ repoRoot: '/remote/project', title: 'project', workspaceId: 'workspace-1', threads: [] }] },
    })
    if ('issues' in valid) throw new Error('The remote JJ repository fixture was rejected.')
    expect(valid.value).toMatchObject({ ok: true, repositories: { repositories: [{}] } })
    const newer = await standard(outputSchema).validate({
      ok: true,
      repositories: {
        repositories: [
          { repoRoot: '/remote/project', title: 'project', workspaceId: 'workspace-1', threads: [], futureStatus: { detail: 'ignored by this client' } },
        ],
      },
    })
    expect('issues' in newer).toBe(true)
    const backwardCompatible = await standard(outputSchema).validate({
      ok: true,
      repositories: { repositories: [], refreshing: false },
    })
    if ('issues' in backwardCompatible) throw new Error('The remote JJ response without optional newer fields was rejected.')
    const invalid = await standard(outputSchema).validate({
      ok: true,
      repositories: { repositories: [{ repoRoot: '/remote/project', title: 'project', workspaceId: 'workspace-1', threads: [{ name: 'thread' }] }] },
    })
    expect('issues' in invalid).toBe(true)
    const missingApi = await standard(outputSchema).validate({
      ok: false,
      code: 'api-owner-missing',
      message: 'The remote runtime does not serve this API.',
    })
    if ('issues' in missingApi) throw new Error('The missing remote API result was rejected.')
    expect(missingApi.value).toMatchObject({ ok: false })
  })
  test('an approval is the human decision: no tool answers one, and no tool declines a question for them', () => {
    expect(multiHostApi.methods.sessionApprovalDecide.tool).toBeUndefined()
    expect(multiHostApi.methods.sessionQuestionDecline.tool).toBeUndefined()
  })

  test('inspection stays read-only and every write needs the user to have asked', () => {
    const readOnly = Object.values(multiHostApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'multi_host_browse',
      'multi_host_doctor',
      'multi_host_file_references',
      'multi_host_identity',
      'multi_host_list',
      'multi_host_local_project_files',
      'multi_host_models',
      'multi_host_project_origins',
      'multi_host_resource_pool',
      'multi_host_resource_snapshot',
      'multi_host_runtime_logs',
      'multi_host_runtime_status',
      'multi_host_session_interactions',
      'multi_host_session_jj_repositories',
      'multi_host_ssh_hosts',
      'multi_host_status',
      'multi_host_thread_transcript',
      'multi_host_threads',
    ])
    for (const method of Object.values(multiHostApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
      if (method.tool.readOnly !== true) expect(method.description ?? '').toMatch(/Call only when the user asked/u)
    }
  })

  test('the raw RPC escape hatches stay untooled on purpose', () => {
    const untooled = [
      'runtimeCall',
      'runtimePluginCall',
      'runtimePeerRead',
      'runtimePing',
      'runtimeOpenView',
      'runtimeCloseView',
      'sessionUploadFile',
      'sessionCursor',
      'sessionRuntime',
    ] as const
    for (const name of untooled) {
      expect(multiHostApi.methods[name].tool).toBeUndefined()
    }
  })
})

describe('runtimePeerRead', () => {
  test('accepts only the allowlisted read-only peer calls', async () => {
    const input = multiHostApi.methods.runtimePeerRead.input
    if (input === undefined) throw new Error('runtimePeerRead has no input schema')
    const boundary = standard(input)
    const accepted = await boundary.validate({ runtimeId: 'runtime-1', call: 'backlog/peerOpsSince', input: { cursor: 0 } })
    expect('issues' in accepted && accepted.issues !== undefined).toBe(false)
    for (const call of ['backlog/capture', 'backlog/delete', 'jj-threads/provision', 'multi-host/remoteExec']) {
      const refused = await boundary.validate({ runtimeId: 'runtime-1', call, input: {} })
      expect('issues' in refused && refused.issues !== undefined).toBe(true)
    }
  })
})
