import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { decodeJson, jsonObjectSchema } from '@dshfiles/dshx/json'
import { readOrCreateRuntimeIdentity } from '../src/identity.js'

const directories: string[] = []
let originalDshHome: string | undefined
let originalProfile: string | undefined
let originalProfileName: string | undefined

beforeEach(async () => {
  originalDshHome = process.env.DSH_HOME
  originalProfile = process.env.DSH_PROFILE
  originalProfileName = process.env.DSH_PROFILE_NAME
  const home = await mkdtemp(join(tmpdir(), 'multi-host-identity-'))
  directories.push(home)
  process.env.DSH_HOME = home
  process.env.DSH_PROFILE = 'identity-test'
  delete process.env.DSH_PROFILE_NAME
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  if (originalProfile === undefined) delete process.env.DSH_PROFILE
  else process.env.DSH_PROFILE = originalProfile
  if (originalProfileName === undefined) delete process.env.DSH_PROFILE_NAME
  else process.env.DSH_PROFILE_NAME = originalProfileName
})

describe('multi-host runtime identity', () => {
  test('persists one stable identity per profile in private storage', async () => {
    const first = await readOrCreateRuntimeIdentity()
    const second = await readOrCreateRuntimeIdentity()
    const identityPath = join(process.env.DSH_HOME ?? '', 'plugins', 'multi-host', 'runtime-identities', 'identity-test.json')
    expect(second).toEqual(first)
    expect((await stat(identityPath)).mode & 0o777).toBe(0o600)
    expect((await stat(dirname(identityPath))).mode & 0o777).toBe(0o700)
    expect(decodeJson(jsonObjectSchema, await readFile(identityPath, 'utf8'))).toMatchObject({ profile: 'identity-test', runtimeId: first.runtimeId })
  })

  test('refuses an identity file redirected through a symlink', async () => {
    const home = process.env.DSH_HOME ?? ''
    const directory = join(home, 'plugins', 'multi-host', 'runtime-identities')
    await mkdir(directory, { recursive: true })
    const identityPath = join(directory, 'identity-test.json')
    const externalPath = join(home, 'external-identity.json')
    await writeFile(externalPath, JSON.stringify({ schemaVersion: 1, profile: 'identity-test', runtimeId: '10000000-0000-4000-8000-000000000001' }))
    await symlink(externalPath, identityPath)
    await expect(readOrCreateRuntimeIdentity()).rejects.toMatchObject({ code: 'identity-path-invalid' })
  })
})
