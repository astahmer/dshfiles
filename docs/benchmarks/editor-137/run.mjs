import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sources = dirname(fileURLToPath(import.meta.url))
const repo = await realpath(resolve(sources, '../../..'))
const command = process.argv[2]
const base = '4c0774edaf0995d0639d235e725a1c977622e62f'
const stage = join(repo, 'node_modules/.editor-137-repro')
const localPath = `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`
const json = async path => JSON.parse(await readFile(path, 'utf8'))

if (!['install', 'desktop', 'phone', 'red', 'native', 'native-phone'].includes(command)) {
  throw new Error('Use: node docs/benchmarks/editor-137/run.mjs install|desktop|phone|red|native|native-phone')
}
assert.equal(process.versions.node, '24.11.1', 'Use the Node version pinned by the evaluated revision.')
const nodeModules = join(repo, 'node_modules')
await mkdir(nodeModules, { recursive: true })
assert((await realpath(nodeModules)) === nodeModules, 'Refuse a redirected node_modules.')
await mkdir(stage, { recursive: true, mode: 0o700 })
assert((await realpath(stage)) === stage, 'Refuse a redirected scratch directory.')
const setupHome = join(stage, 'installer-home')
await mkdir(setupHome, { recursive: true, mode: 0o700 })
assert((await realpath(setupHome)) === setupHome, 'Refuse a redirected installer home.')
const env = { HOME: setupHome, PATH: localPath, TMPDIR: setupHome }

if (command === 'install') {
  await copyFile(join(sources, 'package.json'), join(stage, 'package.json'))
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--prefer-offline'], {
    cwd: stage,
    stdio: 'inherit',
    env: { ...env, npm_config_userconfig: join(setupHome, '.npmrc'), npm_config_globalconfig: '/dev/null' },
  })
  process.exit(0)
}

for (const [id, version] of Object.entries((await json(join(sources, 'package.json'))).dependencies)) {
  assert.equal((await json(join(stage, 'node_modules', id, 'package.json'))).version, version, `Unexpected ${id}; run install first.`)
}
const runRoot = await mkdtemp(join(stage, 'run-'))
const runHome = join(runRoot, 'home')
await mkdir(runHome, { mode: 0o700 })
await symlink(join(stage, 'node_modules'), join(runRoot, 'node_modules'), 'dir')
const runtimeEnv = {
  ...env,
  HOME: runHome,
  TMPDIR: runHome,
  ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: await realpath(process.env.PLAYWRIGHT_BROWSERS_PATH) } : {}),
  PHONE: String(Number(command.endsWith('phone'))),
  RUNS: process.env.RUNS ?? (['phone', 'native-phone', 'red'].includes(command) ? '1' : '5'),
  MODES: command === 'red' ? 'current' : (process.env.MODES ?? 'current,modern-core,modern-full'),
  RED: command === 'red' ? '1' : '',
}
assert(/^[1-9]\d?$/.test(runtimeEnv.RUNS) && Number(runtimeEnv.RUNS) <= 10, 'RUNS must be 1–10.')
assert(
  runtimeEnv.MODES.split(',').every(mode => ['current', 'modern-core', 'modern-full'].includes(mode)),
  'Unknown mode.',
)
const scripts = [
  'bench.mjs',
  'editor-probe.mjs',
  'index.html',
  'native-launch.mjs',
  'native-probe.mjs',
  'package.json',
  'ts-build.mjs',
  'ts-entry.mjs',
  'vite.config.mjs',
]
for (const filename of scripts) await copyFile(join(sources, filename), join(runRoot, filename))
const workspaceFiles = join(runRoot, 'fixture/src')
await mkdir(workspaceFiles, { recursive: true })
assert((await realpath(workspaceFiles)) === workspaceFiles, 'Refuse a redirected fixture path.')
for (const [name, marker, fn] of [
  ['sample.ts', 'synthetic fixture', 'add'],
  ['second.ts', 'synthetic second file', 'sub'],
]) {
  const text = `// ${marker}\n` + Array.from({ length: 240 }, (_, i) => `export const ${fn}${i} = (value: number) => value + ${i}; // line ${i}\n`).join('')
  await writeFile(join(workspaceFiles, name), text)
}
const run = (file, ...args) => execFileSync(process.execPath, [file, ...args], { cwd: runRoot, env: runtimeEnv, stdio: 'inherit' })
try {
  if (command.startsWith('native')) {
    run('native-launch.mjs')
  } else {
    for (const [dest, path] of [
      ['monaco-engine.ts', 'src/monaco-engine.ts'],
      ['monaco-vite.ts', 'monaco-vite.ts'],
    ]) {
      const pinned = execFileSync('jj', ['file', 'show', '-r', base, `plugins/@dshfiles/editor/${path}`], { cwd: repo })
      await writeFile(join(runRoot, dest), pinned)
    }
    run('node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn')
    if (runtimeEnv.MODES.includes('modern-full')) run('ts-build.mjs')
    run('editor-probe.mjs')
  }
} catch (error) {
  if (!Number.isInteger(error.status)) throw error
  process.exitCode = error.status
}
