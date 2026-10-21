import { describe, expect, test } from 'vitest'
import { multiHostApi } from './api.js'

describe('multi-host tool exposure', () => {
  test('every remote/host action a human can take is a named tool', () => {
    const tools = Object.values(multiHostApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'multi_host_browse',
      'multi_host_checkout_sync',
      'multi_host_doctor',
      'multi_host_exec',
      'multi_host_find_homes',
      'multi_host_forget_thread',
      'multi_host_identity',
      'multi_host_list',
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

  test('inspection stays read-only and every write needs the user to have asked', () => {
    const readOnly = Object.values(multiHostApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'multi_host_browse',
      'multi_host_doctor',
      'multi_host_identity',
      'multi_host_list',
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
    const untooled = ['runtimeCall', 'runtimePluginCall', 'runtimePing', 'runtimeOpenView', 'runtimeCloseView', 'sessionCursor'] as const
    for (const name of untooled) {
      expect(multiHostApi.methods[name].tool).toBeUndefined()
    }
  })
})
