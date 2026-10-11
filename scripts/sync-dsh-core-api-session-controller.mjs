import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localPackageRoot = join(repositoryRoot, 'tooling/dsh-core/api-session-controller')
const dshSourceRootValue = process.env.DSH_SOURCE_ROOT

if (dshSourceRootValue === undefined || dshSourceRootValue.trim() === '') {
  throw new Error('Set DSH_SOURCE_ROOT to the matching full DSH source checkout.')
}

const expectedNodeVersion = (await readFile(join(repositoryRoot, '.node-version'), 'utf8')).trim()
if (process.versions.node !== expectedNodeVersion) {
  throw new Error(`Use the repository-pinned Node ${expectedNodeVersion}; found ${process.versions.node}.`)
}

const dshSourceRoot = resolve(dshSourceRootValue)
const upstreamPackageRoot = join(dshSourceRoot, 'packages/api/session-controller')
const upstreamGeneratorRoot = join(dshSourceRoot, 'packages/typert/generator')
const localManifest = await readJson(join(localPackageRoot, 'package.json'))
const upstreamManifest = await readJson(join(upstreamPackageRoot, 'package.json'))
const upstreamRootManifest = await readJson(join(dshSourceRoot, 'package.json'))
const upstreamGeneratorManifest = await readJson(join(upstreamGeneratorRoot, 'package.json'))
const installedGeneratorManifest = await readJson(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-typert-generator/package.json')))

if (upstreamRootManifest.version !== '0.2.0-rc.2' || upstreamRootManifest.packageManager !== 'pnpm@11.7.0') {
  throw new Error('DSH_SOURCE_ROOT must contain the pinned DSH 0.2.0-rc.2 source workspace.')
}

if (
  localManifest.name !== '@deepseek-ai/dsh-api-session-controller'
  || upstreamManifest.name !== localManifest.name
  || upstreamManifest.version !== localManifest.version
  || upstreamGeneratorManifest.version !== '0.2.0-rc.2'
  || installedGeneratorManifest.version !== upstreamGeneratorManifest.version
) {
  throw new Error('The local controller, source controller, and Typert generator versions must match.')
}

const packageName = localManifest.name
const overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-api-session-controller-sync-'))

try {
  await cp(dshSourceRoot, overlayRoot, {
    recursive: true,
    filter: path => !relative(dshSourceRoot, path).split(sep).some(segment =>
      segment === 'node_modules' || segment === '.git' || segment === '.jj',
    ),
  })
  await symlink(join(dshSourceRoot, 'node_modules'), join(overlayRoot, 'node_modules'), 'dir')
  await linkNestedNodeModules(join(dshSourceRoot, 'packages'), join(overlayRoot, 'packages'))
  await linkNestedNodeModules(join(dshSourceRoot, 'vendor'), join(overlayRoot, 'vendor'))

  const overlayPackageRoot = join(overlayRoot, 'packages/api/session-controller')
  await rm(join(overlayPackageRoot, 'src'), { recursive: true, force: true })
  await cp(join(localPackageRoot, 'src'), join(overlayPackageRoot, 'src'), { recursive: true })
  for (const filename of ['package.json', 'tsconfig.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsdown.config.ts']) {
    await copyFile(join(localPackageRoot, filename), join(overlayPackageRoot, filename))
  }
  // Keep temporary compiler metadata outside the generated package output.
  for (const [filename, buildInfoName] of [
    ['tsconfig.host.json', '.controller-host.tsbuildinfo'],
    ['tsconfig.client.json', '.controller-client.tsbuildinfo'],
  ]) {
    const configPath = join(overlayPackageRoot, filename)
    const config = await readJson(configPath)
    await writeFile(configPath, JSON.stringify({
      ...config,
      compilerOptions: {
        ...config.compilerOptions,
        tsBuildInfoFile: join(overlayRoot, buildInfoName),
      },
    }))
  }

  const localSessionRoot = join(repositoryRoot, 'tooling/dsh-core/session')
  const overlaySessionRoot = join(overlayRoot, 'packages/core/session')
  await rm(join(overlaySessionRoot, 'src'), { recursive: true, force: true })
  await cp(join(localSessionRoot, 'src'), join(overlaySessionRoot, 'src'), { recursive: true })
  await copyFile(join(localSessionRoot, 'package.json'), join(overlaySessionRoot, 'package.json'))
  await copyFile(join(dshSourceRoot, 'packages/core/session/tsconfig.json'), join(overlaySessionRoot, 'tsconfig.json'))
  // Preserve the Controller's Cordis/Typert identity; only the local Zod dependency differs.
  const overlaySessionNodeModules = join(overlaySessionRoot, 'node_modules')
  await rm(overlaySessionNodeModules, { recursive: true, force: true })
  await mkdir(overlaySessionNodeModules, { recursive: true })
  await symlink(join(dshSourceRoot, 'packages/core/session/node_modules/@deepseek-ai'), join(overlaySessionNodeModules, '@deepseek-ai'), 'dir')
  await symlink(join(dshSourceRoot, 'node_modules/@types'), join(overlaySessionNodeModules, '@types'), 'dir')
  await symlink(join(repositoryRoot, 'node_modules/zod'), join(overlaySessionNodeModules, 'zod'), 'dir')
  const overlayApiDeepseekModules = join(overlayPackageRoot, 'node_modules/@deepseek-ai')
  await rm(join(overlayApiDeepseekModules, 'dsh-session'), { recursive: true, force: true })
  await symlink(overlaySessionRoot, join(overlayApiDeepseekModules, 'dsh-session'), 'dir')

  const overlayAgentRoot = join(overlayRoot, 'packages/core/agent')
  await copyFile(join(repositoryRoot, 'tooling/dsh-core/agent/src/types.ts'), join(overlayAgentRoot, 'src/types.ts'))
  const overlayAgentDeepseekModules = join(overlayAgentRoot, 'node_modules/@deepseek-ai')
  await rm(join(overlayAgentDeepseekModules, 'dsh-session'), { recursive: true, force: true })
  await symlink(overlaySessionRoot, join(overlayAgentDeepseekModules, 'dsh-session'), 'dir')
  await rm(join(overlayApiDeepseekModules, 'dsh-agent'), { recursive: true, force: true })
  await symlink(overlayAgentRoot, join(overlayApiDeepseekModules, 'dsh-agent'), 'dir')
  const agentProjectConfig = await readJson(join(overlayAgentRoot, 'tsconfig.json'))
  const agentTypesConfig = join(overlayAgentRoot, 'tsconfig.dshfiles-types.json')
  await writeFile(agentTypesConfig, JSON.stringify({
    extends: './tsconfig.json',
    files: ['src/types.ts'],
    include: [],
    references: agentProjectConfig.references,
    compilerOptions: { emitDeclarationOnly: true },
  }))

  const typescript = join(dshSourceRoot, 'node_modules/typescript/bin/tsc')
  const tsdown = join(dshSourceRoot, 'node_modules/.bin/tsdown')
  run(process.execPath, [typescript, '--project', join(overlaySessionRoot, 'tsconfig.json'), '--pretty', 'false'], overlayRoot)
  run(process.execPath, [typescript, '--project', agentTypesConfig, '--pretty', 'false'], overlayRoot)
  run(process.execPath, [typescript, '--project', join(overlayPackageRoot, 'tsconfig.host.json')], overlayRoot)

  const generatorModule = await import('@deepseek-ai/dsh-typert-generator')
  const workspaceModel = new generatorModule.WorkspaceAnalyzer({
    root: overlayRoot,
    hostConfig: 'tsconfig.host.json',
    clientConfig: 'tsconfig.client.json',
    packages: [packageName],
    faces: ['host'],
    checkDiagnostics: false,
    mode: 'check',
  }).analyze()
  const hostFace = workspaceModel.faces.find(face => face.face === 'host')
  if (hostFace === undefined) throw new Error('Typert did not analyze the local Controller Host face.')

  const generatedHost = new generatorModule.FaceModelEmitter(hostFace).emit(packageName)
  const generatedFiles = new Map([
    ['typert.host.js', generatedHost.js],
    ['typert.host.d.ts', generatedHost.dts],
    ['typert.remote-client.js', generatedHost.remote?.js],
    ['typert.remote-client.d.ts', generatedHost.remote?.dts],
    ['typert.remote-client.d.ts.map', generatedHost.remote?.dtsMap],
  ])
  for (const [filename, generatedContents] of generatedFiles) {
    if (generatedContents === undefined) throw new Error(`Typert did not emit ${filename}.`)
    await writeFile(join(overlayPackageRoot, 'lib', filename), generatedContents)
  }

  const requiredRemoteEndpoints = [
    'updateAttention',
    'prepareWorkspaceRestore',
    'confirmWorkspaceRestore',
    'workspaceRestoreStatus',
  ]
  for (const endpoint of requiredRemoteEndpoints) {
    if (
      generatedHost.remote?.dts.includes(`${endpoint}:`) !== true
      || generatedHost.remote.dts.includes(`'session/${endpoint}':`) !== true
    ) {
      throw new Error(`Generated Remote contract is missing the Session ${endpoint} endpoint.`)
    }
  }

  const clientTypeOutput = runClientDeclarations(typescript, overlayPackageRoot, overlayRoot)
  if (clientTypeOutput.diagnostics.length > 0) {
    throw new Error(`Controller Client declaration generation failed:\n${clientTypeOutput.diagnostics.join('\n')}`)
  }

  await assertContains(join(overlayPackageRoot, 'lib/types/index.d.ts'), 'SessionWorkspaceRestorePrepareRequest')
  await assertContains(join(overlayPackageRoot, 'lib/types/client/sessions/manager.d.ts'), 'workspaceRestoreStatus')
  const hostBundle = run(tsdown, ['--env.DSH_BUILD_FACE', 'host'], overlayPackageRoot)
  const clientBundle = run(tsdown, ['--env.DSH_BUILD_FACE', 'client'], overlayPackageRoot)
  if (!hostBundle.includes('Build complete') || !clientBundle.includes('Build complete')) {
    throw new Error('The Controller Host and Client bundle builds did not complete.')
  }

  const sourceLibRoot = join(overlayPackageRoot, 'lib')
  const sourceFiles = await regularFiles(sourceLibRoot)
  const destinationLibRoot = join(localPackageRoot, 'lib')
  await ensureRealDirectory(destinationLibRoot)
  const destinationFiles = await regularFiles(destinationLibRoot)
  const sourceNames = new Set(sourceFiles.map(file => file.relativePath))

  for (const destinationFile of destinationFiles) {
    if (!sourceNames.has(destinationFile.relativePath)) await rm(destinationFile.absolutePath)
  }

  for (const sourceFile of sourceFiles) {
    const destinationPath = join(destinationLibRoot, sourceFile.relativePath)
    await mkdir(dirname(destinationPath), { recursive: true })
    await copyFile(sourceFile.absolutePath, destinationPath)
  }

  const digest = createHash('sha256')
  for (const sourceFile of sourceFiles) {
    digest.update(sourceFile.relativePath)
    digest.update('\0')
    digest.update(await readFile(sourceFile.absolutePath))
    digest.update('\0')
  }
  process.stdout.write(`Synced ${sourceFiles.length} Controller outputs from the local source overlay; SHA-256 ${digest.digest('hex')}.\n`)
} finally {
  await rm(overlayRoot, { recursive: true, force: true })
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function regularFiles(directory) {
  const files = []

  const visit = async currentDirectory => {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const absolutePath = join(currentDirectory, entry.name)
      const fileStats = await lstat(absolutePath)
      if (fileStats.isSymbolicLink()) throw new Error(`Refusing symlink in generated output tree: ${absolutePath}`)
      if (fileStats.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!fileStats.isFile()) throw new Error(`Unexpected non-file in generated output tree: ${absolutePath}`)
      files.push({ absolutePath, relativePath: relative(directory, absolutePath).split(sep).join('/') })
    }
  }

  await visit(directory)
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function linkNestedNodeModules(sourceDirectory, destinationDirectory) {
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() && entry.name !== 'node_modules') continue
    if (entry.name === '.git' || entry.name === '.jj') continue
    const sourcePath = join(sourceDirectory, entry.name)
    const destinationPath = join(destinationDirectory, entry.name)
    if (entry.name === 'node_modules') {
      await symlink(sourcePath, destinationPath, 'dir')
      continue
    }
    try {
      if ((await lstat(destinationPath)).isDirectory()) {
        await linkNestedNodeModules(sourcePath, destinationPath)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  })
}

function runClientDeclarations(typescript, packageRoot, workspaceRoot) {
  try {
    run(process.execPath, [typescript, '--project', join(packageRoot, 'tsconfig.client.json'), '--pretty', 'false'], workspaceRoot)
    return { diagnostics: [] }
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join('\n')
    return { diagnostics: output.split('\n').filter(line => /error TS\d+/.test(line)) }
  }
}

async function assertContains(path, expectedText) {
  const contents = await readFile(path, 'utf8')
  if (!contents.includes(expectedText)) throw new Error(`${relative(repositoryRoot, path)} is missing ${expectedText}.`)
}

async function ensureRealDirectory(directory) {
  try {
    const fileStats = await lstat(directory)
    if (fileStats.isSymbolicLink() || !fileStats.isDirectory()) {
      throw new Error(`Refusing non-directory generated output path: ${directory}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(directory, { recursive: true })
  }
}
