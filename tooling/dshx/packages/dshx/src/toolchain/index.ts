import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execa } from 'execa'
import type { Writable } from 'node:stream'
import { DshxError } from '../diagnostics.js'
import { decodeJson, jsonValueSchema } from '../json.js'
import type { JsonValue } from '../json.js'

export interface TestProjectOptions {
  readonly stdout?: Writable
  readonly stderr?: Writable
  readonly file?: string
}

/** Run the project's own Vitest installation. No profile or application process is needed. */
export async function testProject(root: string, options: TestProjectOptions = {}): Promise<number> {
  // Walk normal project/workspace node_modules locations. NODE_PATH can expose
  // the SDK's own runner; that is not this project's test dependency.
  let directory = resolve(root)
  let cli: string | undefined
  for (;;) {
    const candidate = resolve(directory, 'node_modules/vitest/vitest.mjs')
    try {
      await access(candidate)
      cli = candidate
      break
    } catch {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  if (cli === undefined) {
    throw new DshxError('DSHX6401', 'This project has no Vitest installation.', {
      file: resolve(root, 'package.json'),
      hint: 'Run "pnpm add -D vitest", then add a *.test.ts or *.spec.ts file using @dshfiles/dshx/testing.',
    })
  }
  const subprocess = execa(process.execPath, [cli, 'run', ...(options.file === undefined ? [] : [options.file])], {
    cwd: root,
    reject: false,
  })
  // CLI IO can be a captured Writable without a file descriptor. Keep native
  // subprocess pipes and leave the caller's streams open across commands.
  if (options.stdout) subprocess.stdout?.pipe(options.stdout, { end: false })
  if (options.stderr) subprocess.stderr?.pipe(options.stderr, { end: false })
  const result = await subprocess
  if (result.exitCode === undefined)
    throw new DshxError('DSHX6404', 'The project test runner could not start or finish.', {
      file: cli,
      hint: 'Check your Node installation and rerun the project-local Vitest command directly for startup diagnostics.',
    })
  return result.exitCode ?? 1
}

interface PackMetadata {
  readonly filename: string
  readonly files: readonly { readonly path: string }[]
}

function packMetadata(stdout: string): PackMetadata {
  const parsed = decodeJson(jsonValueSchema, stdout)
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('npm returned an unexpected pack report')
  const value: JsonValue | undefined = parsed[0]
  if (
    typeof value !== 'object' ||
    value === null ||
    !('filename' in value) ||
    typeof value.filename !== 'string' ||
    !('files' in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error('npm returned an incomplete pack report')
  }
  const files = value.files.map(file => {
    if (typeof file !== 'object' || file === null || !('path' in file) || typeof file.path !== 'string') throw new Error('npm returned an invalid pack file')
    return { path: file.path }
  })
  return { filename: value.filename, files }
}

/** Validate npm's real pack list, then produce an ordinary native bundle tarball without publishing. */
export async function packageProject(root: string, requiredFiles: readonly string[]): Promise<string> {
  const preview = await execa('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, reject: false })
  if (preview.exitCode !== 0)
    throw new DshxError('DSHX6402', 'npm could not inspect this plugin package.', {
      file: resolve(root, 'package.json'),
      hint: preview.stderr || 'Fix package.json and rerun dshx package.',
    })
  const included = new Set(packMetadata(preview.stdout).files.map(file => file.path))
  const missing = requiredFiles.map(file => file.replace(/^\.\//, '')).filter(file => !included.has(file))
  if (missing.length > 0)
    throw new DshxError('DSHX6403', `The package would omit required plugin files: ${missing.join(', ')}.`, {
      file: resolve(root, 'package.json'),
      hint: 'Include the build output and cordis.patch.yml in package.json files, and remove conflicting .npmignore rules.',
    })
  const packed = await execa('npm', ['pack', '--ignore-scripts', '--json'], { cwd: root, reject: false })
  if (packed.exitCode !== 0)
    throw new DshxError('DSHX6402', 'npm could not package this plugin.', {
      file: resolve(root, 'package.json'),
      hint: packed.stderr || 'Fix the reported npm problem and rerun dshx package.',
    })
  const filename = packMetadata(packed.stdout).filename
  if (dirname(filename) !== '.') throw new Error('npm returned a package filename outside the project directory')
  return resolve(root, filename)
}
