import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const isMissing = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * One `dshx build` writes every face into a sibling staging directory, then replaces the output directory with two
 * renames. A running Host that polls `dist/` (client HMR, hmr-gate) sees one complete change per build instead of a
 * burst of partial files, and a file the build no longer produces leaves with the old directory. The staging directory
 * is a sibling so sourcemap sources and the Host package-root URL, both relative to the output directory, stay the same.
 */
export class StagedOutput {
  private constructor(
    readonly directory: string,
    private readonly outDir: string,
  ) {}

  static async create(outDir: string): Promise<StagedOutput> {
    const parent = dirname(outDir)
    const prefix = `.${basename(outDir)}.dshx-`
    // A build interrupted before publish leaves its staging directory behind; its pid names the owner.
    const leftovers = (await readdir(parent).catch(() => [] as string[])).filter(name => {
      if (!name.startsWith(prefix)) return false
      const pid = Number(/^(\d+)-/u.exec(name.slice(prefix.length))?.[1])
      return Number.isInteger(pid) && pid !== process.pid && !isRunning(pid)
    })
    await Promise.all(leftovers.map(name => rm(resolve(parent, name), { recursive: true, force: true })))
    const directory = resolve(parent, `${prefix}${process.pid}-${randomBytes(4).toString('hex')}`)
    await mkdir(directory, { recursive: true })
    // Keeps VCS snapshots and turbo's default inputs from recording a build in progress.
    await writeFile(resolve(directory, '.gitignore'), '*\n', 'utf8')
    return new StagedOutput(directory, outDir)
  }

  async publish(): Promise<void> {
    await rm(resolve(this.directory, '.gitignore'), { force: true })
    const retired = `${this.directory}-retired`
    const replaced = await rename(this.outDir, retired).then(
      () => true,
      (error: unknown) => {
        if (isMissing(error)) return false
        throw error
      },
    )
    try {
      await rename(this.directory, this.outDir)
    } catch (error) {
      if (replaced) await rename(retired, this.outDir)
      throw error
    }
    if (replaced) await rm(retired, { recursive: true, force: true })
  }

  async discard(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true })
  }
}
