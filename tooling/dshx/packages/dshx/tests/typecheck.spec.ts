import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { typecheckProject } from '../src/project/typecheck.js'

const directories: string[] = []
const project = async (source: string): Promise<string> => {
  const root = await mkdtemp(resolve(tmpdir(), 'dshx-native-typecheck-'))
  directories.push(root)
  await writeFile(
    resolve(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, types: [], target: 'ES2023', module: 'NodeNext' }, include: ['*.ts'] }),
  )
  await writeFile(resolve(root, 'source file.ts'), source)
  return root
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('native project typecheck', () => {
  it('checks valid source without emitting files', async () => {
    const root = await project('export const value: string = "valid"\n')
    expect(await typecheckProject(root)).toMatchObject({ status: 'passed', diagnostics: [] })
  })
  it('preserves diagnostic codes, locations and paths with spaces', async () => {
    const root = await project('export const value: string = 42\n')
    const result = await typecheckProject(root)
    expect(result.status).toBe('failed')
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'TS2322', file: resolve(root, 'source file.ts'), message: expect.stringMatching(/^1:14:/) }),
    )
  })
  it('reports malformed configuration', async () => {
    const root = await project('export const value = 1\n')
    await writeFile(resolve(root, 'tsconfig.json'), '{ invalid configuration')
    const result = await typecheckProject(root)
    expect(result.status).toBe('failed')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every(diagnostic => diagnostic.severity === 'error')).toBe(true)
  })
  it('reports absent configuration before spawning the compiler', async () => {
    const root = await project('export const value = 1\n')
    await rm(resolve(root, 'tsconfig.json'))
    expect(await typecheckProject(root)).toMatchObject({ status: 'failed', diagnostics: [{ code: 'DSHX4401' }] })
  })
})
