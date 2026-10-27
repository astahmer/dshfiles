import { describe, expect, test } from 'vitest'
import { multiHostApi } from './api.js'

describe('multi-host tool exposure', () => {
  test('every remote/host action a human can take is a named tool', () => {
    const tools = Object.values(multiHostApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'multi_host_browse',
      'multi_host_checkout_sync',
      'multi_host_clone_project',
      'multi_host_create_thread',
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
      'multi_host_provision',
      'multi_host_reconnect',
      'multi_host_remove_host',
      'multi_host_remove_runtime',
      'multi_host_reorder_hosts',
      'multi_host_runtime_control',
      'multi_host_runtime_logs',
      'multi_host_runtime_status',
      'multi_host_save_ssh_host',
      'multi_host_set_host_hidden',
      'multi_host_ssh_hosts',
      'multi_host_start_thread',
      'multi_host_status',
      'multi_host_test',
      'multi_host_thread_reply',
      'multi_host_thread_stop',
      'multi_host_thread_transcript',
      'multi_host_threads',
    ])
  })

  test('remote cloning accepts safe destinations and complete local-file selections', async () => {
    const inputSchema = multiHostApi.methods.runtimeCloneProject.input
    if (inputSchema === undefined) throw new Error('The remote clone API must define an input schema.')
    const accepts = async (repositoryUrl: string, destinationPath: string): Promise<boolean> => {
      const result = await inputSchema['~standard'].validate({ runtimeId: 'runtime', repositoryUrl, destinationPath })
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
      copyPaths: ['.env', 'notes.txt'],
    }
    expect('issues' in (await cloneInput['~standard'].validate(copyInput))).toBe(false)
    expect('issues' in (await cloneInput['~standard'].validate({ ...copyInput, copyPaths: ['../outside'] }))).toBe(true)
    expect('issues' in (await cloneInput['~standard'].validate({ ...copyInput, copyPaths: ['bad\0path'] }))).toBe(true)
    expect('issues' in (await cloneInput['~standard'].validate({ ...copyInput, copyPaths: undefined }))).toBe(true)
    expect('issues' in (await cloneInput['~standard'].validate({ ...copyInput, copyFromPath: undefined }))).toBe(true)
  })

  test('remote model results preserve reasoning choices', async () => {
    const outputSchema = multiHostApi.methods.runtimeModels.output
    if (outputSchema === undefined) throw new Error('The remote model catalog API must define an output schema.')
    const validation = await outputSchema['~standard'].validate({
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
    if (!validation.value.ok) throw new Error('The remote model catalog fixture must be successful.')
    expect(validation.value.groups[0]?.models[0]?.reasoning?.efforts[0]?.id).toBe('high')
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
      'multi_host_runtime_logs',
      'multi_host_runtime_status',
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
