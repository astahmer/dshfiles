import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import writeFileAtomic from 'write-file-atomic'

export interface FilePlan {
  readonly file: string
  readonly before?: string
  readonly after: string
}

export interface FilePlanFileSystem {
  readonly mkdir: (file: string, options: { readonly recursive: true }) => Promise<unknown>
  readonly writeFile: (file: string, data: string, encoding: 'utf8') => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly unlink: (file: string) => Promise<void>
  readonly writeFileAtomic?: (file: string, data: string) => Promise<void>
}

const defaultFileSystem: FilePlanFileSystem = {
  mkdir,
  writeFile,
  rename,
  unlink,
  writeFileAtomic: async (file, data) => writeFileAtomic(file, data, { encoding: 'utf8' }),
}

const insideProject = (root: string, target: string): boolean => {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep)
}

const readOptionalFile = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

const renderFileDiff = (plan: readonly FilePlan[]): string => {
  return plan
    .map(item => createTwoFilesPatch(item.file, item.file, item.before ?? '', item.after, item.before === undefined ? 'new file' : 'before', 'after'))
    .join('\n')
}

async function atomicWrite(file: string, data: string, fs: FilePlanFileSystem, index: number): Promise<void> {
  if (fs.writeFileAtomic !== undefined) {
    await fs.writeFileAtomic(file, data)
    return
  }
  const temp = `${file}.dshx-tmp-${process.pid}-${index}`
  try {
    await fs.writeFile(temp, data, 'utf8')
    await fs.rename(temp, file)
  } catch (cause) {
    await fs.unlink(temp).catch(() => undefined)
    throw cause
  }
}

const applyFilePlanWithFileSystem = async (plan: readonly FilePlan[], fs: FilePlanFileSystem): Promise<void> => {
  const applied: FilePlan[] = []
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index]!
      await fs.mkdir(dirname(item.file), { recursive: true })
      await atomicWrite(item.file, item.after, fs, index)
      applied.push(item)
    }
  } catch (cause) {
    await rollbackFilePlanWithFileSystem(applied, fs)
    throw cause
  }
}

const applyFilePlan = async (plan: readonly FilePlan[]): Promise<void> => {
  await applyFilePlanWithFileSystem(plan, defaultFileSystem)
}

const rollbackFilePlanWithFileSystem = async (plan: readonly FilePlan[], fs: FilePlanFileSystem): Promise<void> => {
  for (const [index, item] of [...plan].reverse().entries()) {
    if (item.before === undefined) await fs.unlink(item.file).catch(() => undefined)
    else await atomicWrite(item.file, item.before, fs, index).catch(() => undefined)
  }
}

const rollbackFilePlan = async (plan: readonly FilePlan[]): Promise<void> => {
  await rollbackFilePlanWithFileSystem(plan, defaultFileSystem)
}

const writeFileAtomically = async (file: string, data: string): Promise<void> => {
  await defaultFileSystem.writeFileAtomic!(file, data)
}

export class ScaffoldFilePlan {
  static readonly insideProject = insideProject
  static readonly readOptionalFile = readOptionalFile
  static readonly renderFileDiff = renderFileDiff
  static readonly applyFilePlan = applyFilePlan
  static readonly applyFilePlanWithFileSystem = applyFilePlanWithFileSystem
  static readonly rollbackFilePlan = rollbackFilePlan
  static readonly rollbackFilePlanWithFileSystem = rollbackFilePlanWithFileSystem
  static readonly writeFileAtomically = writeFileAtomically
}
