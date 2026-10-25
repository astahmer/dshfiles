import { describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSecretPrintMetadata } from './secret-metadata.js'
import { createSecretCatalogOperations, type SecretCliRequest } from './secret-operations.js'
import { createWorkspacePickerPorts, type WorkspacePickerRemote } from '@dshfiles/project-folder-picker'

describe('Secret Catalog metadata and exact alias actions', () => {
  it('projects only value-free metadata from the CLI JSON contract', () => {
    const rows = parseSecretPrintMetadata(
      JSON.stringify([
        {
          alias: 'SYNTHETIC_API_TOKEN',
          scope: 'global',
          env: 'prod',
          envKey: 'SYNTHETIC_API_TOKEN',
          item: 'synthetic-service',
          field: 'password',
          value: 'synthetic-secret-must-not-cross',
        },
      ]),
    )
    expect(rows).toEqual([
      {
        id: '["global","SYNTHETIC_API_TOKEN","prod","synthetic-service","password"]',
        alias: 'SYNTHETIC_API_TOKEN',
        scope: 'global',
        environment: 'prod',
        variableName: 'SYNTHETIC_API_TOKEN',
        item: 'synthetic-service',
        field: 'password',
        service: 'synthetic-service',
        description: 'synthetic-service',
      },
    ])
    expect(JSON.stringify(rows)).not.toContain('synthetic-secret-must-not-cross')
  })

  it('uses global-only metadata without a folder and all scope metadata with one', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => JSON.stringify([{ alias: 'SYNTHETIC' }]))
    const operations = createSecretCatalogOperations(run)
    expect(await operations.list(null)).toMatchObject([{ scope: 'global', alias: 'SYNTHETIC' }])
    expect(run).toHaveBeenLastCalledWith({ args: ['print', 'global', '--json'], cwd: null, captureStdout: true })
    expect(await operations.list('/tmp/demo')).toHaveLength(1)
    expect(run).toHaveBeenLastCalledWith({ args: ['print', '--all', '--json'], cwd: '/tmp/demo', captureStdout: true })
  })

  it('shares one CLI read among concurrent lists and drops it once a write starts', async () => {
    const releases: (() => void)[] = []
    let holding = true
    let printed = 0
    const run = vi.fn(async (request: SecretCliRequest) => {
      if (request.args[0] !== 'print') return ''
      printed += 1
      // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: later lists bump the counter before this one returns.
      const generation = printed
      if (holding) await new Promise<void>(resolve => releases.push(resolve))
      return JSON.stringify([{ alias: `SYNTHETIC_${generation}` }])
    })
    const operations = createSecretCatalogOperations(run)
    const first = operations.list(null)
    const second = operations.list(null)
    await vi.waitFor(() => expect(printed).toBe(1))
    await operations.removeAlias('SYNTHETIC_1', 'global', null)
    const afterWrite = operations.list(null)
    await vi.waitFor(() => expect(printed).toBe(2))
    holding = false
    for (const release of releases) release()
    expect((await first)[0]?.alias).toBe('SYNTHETIC_1')
    expect((await second)[0]?.alias).toBe('SYNTHETIC_1')
    expect((await afterWrite)[0]?.alias).toBe('SYNTHETIC_2')
    expect(await operations.list(null)).toHaveLength(1)
    expect(printed).toBe(3)
  })

  it('refuses metadata a CLI would read as another flag, before running anything', async () => {
    const requests: SecretCliRequest[] = []
    const operations = createSecretCatalogOperations(async request => {
      requests.push(request)
      return '[]'
    })
    await expect(
      operations.create({
        alias: 'SYNTHETIC',
        scope: 'global',
        cwd: null,
        environment: 'prod',
        valueMode: 'generate',
        value: null,
        name: '--global',
      }),
    ).rejects.toThrow()
    await expect(
      operations.update({
        alias: 'SYNTHETIC',
        scope: 'global',
        cwd: null,
        environment: 'prod',
        value: null,
        tags: '-f',
      }),
    ).rejects.toThrow()
    expect(requests.filter(request => request.args[0] !== 'print')).toEqual([])
  })

  it('runs reveal and clipboard copy only when exact alias methods are called', async () => {
    const run = vi.fn(async (request: SecretCliRequest) => (request.args[0] === 'get' ? 'synthetic-value\n' : ''))
    const operations = createSecretCatalogOperations(run)
    expect(run).not.toHaveBeenCalled()
    expect(await operations.reveal('SYNTHETIC_TOKEN', 'global', null)).toBe('synthetic-value')
    expect(run).toHaveBeenLastCalledWith({
      args: ['get', 'SYNTHETIC_TOKEN', '--config', join(homedir(), '.config', 'secret', 'config.json')],
      cwd: null,
      captureStdout: true,
    })
    expect(await operations.copy('SYNTHETIC_TOKEN', 'global', null)).toEqual({ copied: true })
    expect(run).toHaveBeenLastCalledWith({
      args: ['get', 'SYNTHETIC_TOKEN', '--config', join(homedir(), '.config', 'secret', 'config.json'), '--copy'],
      cwd: null,
      captureStdout: false,
    })
  })

  it('targets a local alias file and environment for deliberate value actions', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => 'synthetic-value')
    const operations = createSecretCatalogOperations(run)
    await operations.reveal('SYNTHETIC_TOKEN', 'local', '/tmp/project', 'dev')
    expect(run).toHaveBeenLastCalledWith({
      args: ['get', 'SYNTHETIC_TOKEN', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
      cwd: '/tmp/project',
      captureStdout: true,
    })
  })

  it('adds generated aliases using the selected scope and exact CLI flags', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '[]')
    const operations = createSecretCatalogOperations(run)
    await operations.create({
      alias: 'SYNTHETIC_NEW',
      scope: 'project',
      cwd: '/tmp/project',
      environment: 'prod',
      valueMode: 'generate',
      value: null,
      name: 'Synthetic item',
    })
    expect(run.mock.calls).toEqual([
      [{ args: ['print', '--all', '--json'], cwd: '/tmp/project', captureStdout: true }],
      [{ args: ['set', 'SYNTHETIC_NEW', '--env', 'prod', '--name', 'Synthetic item', '--generate'], cwd: '/tmp/project', captureStdout: false }],
    ])
  })

  it('adds global aliases in the requested environment without a project folder', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '[]')
    const operations = createSecretCatalogOperations(run)
    await operations.create({
      alias: 'SYNTHETIC_GLOBAL',
      scope: 'global',
      cwd: null,
      environment: 'staging',
      valueMode: 'generate',
      value: null,
    })
    expect(run.mock.calls).toEqual([
      [{ args: ['print', 'global', '--json'], cwd: null, captureStdout: true }],
      [{ args: ['set', 'SYNTHETIC_GLOBAL', '--env', 'staging', '--global', '--generate'], cwd: null, captureStdout: false }],
    ])
  })

  it('adds manual local aliases over stdin without putting their values in argv or output', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '[]')
    const operations = createSecretCatalogOperations(run)
    await operations.create({
      alias: 'SYNTHETIC_LOCAL',
      scope: 'local',
      cwd: '/tmp/project',
      environment: 'prod',
      valueMode: 'manual',
      value: 'synthetic-input-value',
    })
    expect(run.mock.calls).toEqual([
      [{ args: ['print', '--all', '--json'], cwd: '/tmp/project', captureStdout: true }],
      [
        {
          args: ['set', 'SYNTHETIC_LOCAL', '--env', 'prod', '--config', '/tmp/project/.secret.local.json'],
          cwd: '/tmp/project',
          captureStdout: false,
          stdin: 'synthetic-input-value',
        },
      ],
    ])
    expect(run.mock.calls.flatMap(([request]) => request.args)).not.toContain('synthetic-input-value')
  })

  it('refuses to add an alias already present in the current environment', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => JSON.stringify([{ alias: 'SYNTHETIC_EXISTING', scope: 'global', env: 'prod' }]))
    const operations = createSecretCatalogOperations(run)
    await expect(
      operations.create({
        alias: 'SYNTHETIC_EXISTING',
        scope: 'project',
        cwd: '/tmp/project',
        environment: 'prod',
        valueMode: 'generate',
        value: null,
      }),
    ).rejects.toThrow('already exists')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('adds the same alias in a different explicitly selected environment', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => JSON.stringify([{ alias: 'SYNTHETIC_ENV_ALIAS', scope: 'project', env: 'dev' }]))
    const operations = createSecretCatalogOperations(run)
    await operations.create({
      alias: 'SYNTHETIC_ENV_ALIAS',
      scope: 'project',
      cwd: '/tmp/project',
      environment: 'prod',
      valueMode: 'generate',
      value: null,
    })
    expect(run.mock.calls[1]?.[0]).toEqual({
      args: ['set', 'SYNTHETIC_ENV_ALIAS', '--env', 'prod', '--generate'],
      cwd: '/tmp/project',
      captureStdout: false,
    })
  })

  it('edits metadata and replaces values only through explicit operation calls', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '')
    const operations = createSecretCatalogOperations(run)
    expect(run).not.toHaveBeenCalled()
    await operations.update({
      alias: 'SYNTHETIC_EXISTING',
      scope: 'local',
      cwd: '/tmp/project',
      environment: 'dev',
      value: 'synthetic-replacement',
      name: 'Renamed item',
      tags: '',
    })
    expect(run.mock.calls).toEqual([
      [
        {
          args: ['edit', 'SYNTHETIC_EXISTING', '--name', 'Renamed item', '--tags', '', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
          cwd: '/tmp/project',
          captureStdout: false,
        },
      ],
      [
        {
          args: ['set', 'SYNTHETIC_EXISTING', '--force', '--env', 'dev', '--config', '/tmp/project/.secret.local.json'],
          cwd: '/tmp/project',
          captureStdout: false,
          stdin: 'synthetic-replacement',
        },
      ],
    ])
    expect(run.mock.calls.flatMap(([request]) => request.args)).not.toContain('synthetic-replacement')
  })

  it('renames an alias in its own config before editing it under the new name', async () => {
    const run = vi.fn(async (request: SecretCliRequest) => (request.args[0] === 'print' ? JSON.stringify([{ alias: 'SYNTHETIC_OLD' }]) : ''))
    const operations = createSecretCatalogOperations(run)
    await operations.update({
      alias: 'SYNTHETIC_OLD',
      newAlias: 'SYNTHETIC_NEW',
      scope: 'global',
      cwd: null,
      environment: 'prod',
      value: null,
      source: 'https://example.test',
    })
    expect(run.mock.calls.map(([request]) => request.args)).toEqual([
      ['print', 'global', '--json'],
      ['mv', 'SYNTHETIC_OLD', 'SYNTHETIC_NEW', '--global'],
      ['edit', 'SYNTHETIC_NEW', '--source', 'https://example.test', '--env', 'prod', '--config', join(homedir(), '.config', 'secret', 'config.json')],
    ])
  })

  it('refuses a rename onto an alias that already exists', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => JSON.stringify([{ alias: 'SYNTHETIC_OLD' }, { alias: 'SYNTHETIC_TAKEN' }]))
    const operations = createSecretCatalogOperations(run)
    await expect(
      operations.update({ alias: 'SYNTHETIC_OLD', newAlias: 'SYNTHETIC_TAKEN', scope: 'global', cwd: null, environment: 'prod', value: null }),
    ).rejects.toThrow('already exists')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps project alias removal distinct from global item deletion', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '')
    const operations = createSecretCatalogOperations(run)
    await operations.removeAlias('SYNTHETIC_EXISTING', 'project', '/tmp/project')
    expect(run).toHaveBeenLastCalledWith({
      args: ['unset', 'SYNTHETIC_EXISTING'],
      cwd: '/tmp/project',
      captureStdout: false,
    })
    await operations.deleteItem('SYNTHETIC_EXISTING', 'global', null, 'prod')
    expect(run).toHaveBeenLastCalledWith({
      args: ['rm', 'SYNTHETIC_EXISTING', '--force', '--env', 'prod', '--config', join(homedir(), '.config', 'secret', 'config.json')],
      cwd: null,
      captureStdout: false,
    })
  })

  it('rejects unsupported aliases, invalid environments, and relative paths before invoking the CLI', async () => {
    const run = vi.fn(async (_request: SecretCliRequest) => '')
    const operations = createSecretCatalogOperations(run)
    await expect(operations.reveal('1NOT_VALID', 'project', '/tmp/project')).rejects.toThrow()
    await expect(operations.copy('SYNTHETIC', 'local', 'relative/path')).rejects.toThrow('canonical absolute folder path')
    await expect(operations.reveal('SYNTHETIC', 'project', '/tmp/project', '../prod')).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('routes picker browsing and workspace registration through the Host Remote contracts', async () => {
    const calls: string[] = []
    const remote: WorkspacePickerRemote = {
      directoryPicker: {
        pick: async () => {
          calls.push('pick')
          return { ok: true, value: '/work/repo' }
        },
        list: async path => {
          calls.push(`list:${path ?? ''}`)
          return { ok: true, value: { path: path ?? '/work', home: '/home/me', crumbs: [], entries: [], truncated: false } }
        },
        createDirectory: async (path, name) => {
          calls.push(`mkdir:${path}/${name}`)
          return { ok: true, value: `${path}/${name}` }
        },
      },
      workspace: {
        create: async input => {
          calls.push(`workspace:${input.path}`)
          return { ok: true, value: { workspace: { workspaceId: 'workspace-7', path: input.path, title: 'repo' }, created: true } }
        },
      },
    }
    const ports = createWorkspacePickerPorts(remote)
    expect(await ports.directoryPicker.pick(new AbortController().signal)).toBe('/work/repo')
    expect((await ports.directoryPicker.list('/work/repo', new AbortController().signal)).path).toBe('/work/repo')
    expect(await ports.directoryPicker.createDirectory('/work/repo', 'new')).toBe('/work/repo/new')
    expect(await ports.registerWorkspace('/work/repo')).toEqual({
      workspaceId: 'workspace-7',
      title: 'repo',
      canonicalPath: '/work/repo',
    })
    expect(calls).toEqual(['pick', 'list:/work/repo', 'mkdir:/work/repo/new', 'workspace:/work/repo'])
  })

  it('surfaces Host capability refusal instead of inventing a local picker result', async () => {
    const remote: WorkspacePickerRemote = {
      directoryPicker: {
        pick: async () => ({ ok: false, error: 'unsupported' }),
        list: async () => ({ ok: false, error: 'unsupported' }),
        createDirectory: async () => ({ ok: false, error: 'unsupported' }),
      },
      workspace: {
        create: async () => ({ ok: false, error: 'unsupported' }),
      },
    }
    const ports = createWorkspacePickerPorts(remote)
    await expect(ports.directoryPicker.pick(new AbortController().signal)).rejects.toThrow('Folder picking is unavailable.')
    await expect(ports.directoryPicker.list(undefined, new AbortController().signal)).rejects.toThrow('Folder browsing is unavailable.')
    await expect(ports.directoryPicker.createDirectory('/tmp/project', 'new')).rejects.toThrow('Folder creation is unavailable.')
    await expect(ports.registerWorkspace('/tmp/project')).rejects.toThrow('Workspace registration was refused.')
  })
})
