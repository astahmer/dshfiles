import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises'
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

for (const directory of ['src']) {
  await assertDirectoriesMatch(join(localPackageRoot, directory), join(upstreamPackageRoot, directory))
}

for (const filename of ['tsconfig.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsdown.config.ts']) {
  const localContents = await readFile(join(localPackageRoot, filename))
  const upstreamContents = await readFile(join(upstreamPackageRoot, filename))
  if (!localContents.equals(upstreamContents)) {
    throw new Error(`Local controller build input differs from the pinned DSH source: ${filename}`)
  }
}

const generatorModule = await import('@deepseek-ai/dsh-typert-generator')
const packageName = localManifest.name
const workspaceModel = new generatorModule.WorkspaceAnalyzer({
  root: dshSourceRoot,
  hostConfig: 'tsconfig.host.json',
  clientConfig: 'tsconfig.client.json',
  packages: [packageName],
  faces: ['host'],
  checkDiagnostics: false,
  mode: 'check',
}).analyze()
const hostFace = workspaceModel.faces.find(face => face.face === 'host')

if (hostFace === undefined) throw new Error('Typert did not analyze the controller Host face.')

const generatedHost = new generatorModule.FaceModelEmitter(hostFace).emit(packageName)
const generatedFiles = new Map([
  ['typert.host.js', generatedHost.js],
  ['typert.host.d.ts', generatedHost.dts],
  ['typert.remote-client.js', generatedHost.remote?.js],
  ['typert.remote-client.d.ts', generatedHost.remote?.dts],
  ['typert.remote-client.d.ts.map', generatedHost.remote?.dtsMap],
])

const upstreamLibRoot = join(upstreamPackageRoot, 'lib')
for (const [filename, generatedContents] of generatedFiles) {
  if (generatedContents === undefined) throw new Error(`Typert did not emit ${filename}.`)
  const upstreamContents = await readFile(join(upstreamLibRoot, filename), 'utf8')
  if (upstreamContents !== generatedContents) {
    throw new Error(`Pinned DSH build output is stale for ${filename}; rebuild the DSH Host face first.`)
  }
}

if (
  generatedHost.remote?.dts.includes('updateAttention:') !== true
  || generatedHost.remote.dts.includes("'session/updateAttention':") !== true
) {
  throw new Error('Generated Remote contract is missing one of the Session attention endpoints.')
}

for (const [filename, expectedText] of [
  ['index.js', 'updateAttention'],
  ['client.js', 'updateAttention'],
  ['types/index.d.ts', 'SessionAttentionUpdateRequest'],
  ['typert.remote-client.d.ts', 'updateAttention'],
]) {
  const contents = await readFile(join(upstreamLibRoot, filename), 'utf8')
  if (!contents.includes(expectedText)) throw new Error(`Pinned DSH output ${filename} is missing ${expectedText}.`)
}

const sourceFiles = await regularFiles(upstreamLibRoot)
const destinationLibRoot = join(localPackageRoot, 'lib')
await ensureRealDirectory(destinationLibRoot)
const destinationFiles = await regularFiles(destinationLibRoot)
const sourceNames = new Set(sourceFiles.map(file => file.relativePath))

for (const destinationFile of destinationFiles) {
  if (!sourceNames.has(destinationFile.relativePath)) {
    await rm(destinationFile.absolutePath)
  }
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

process.stdout.write(`Synced ${sourceFiles.length} controller build files; SHA-256 ${digest.digest('hex')}.\n`)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function assertDirectoriesMatch(localDirectory, upstreamDirectory) {
  const localFiles = await regularFiles(localDirectory)
  const upstreamFiles = await regularFiles(upstreamDirectory)
  const localNames = localFiles.map(file => file.relativePath)
  const upstreamNames = upstreamFiles.map(file => file.relativePath)

  if (localNames.length !== upstreamNames.length || localNames.some((name, index) => name !== upstreamNames[index])) {
    throw new Error(`Local controller source file set differs from the pinned DSH source: ${relative(localPackageRoot, localDirectory)}`)
  }

  for (const [index, localFile] of localFiles.entries()) {
    const upstreamFile = upstreamFiles[index]
    if (upstreamFile === undefined || !(await readFile(localFile.absolutePath)).equals(await readFile(upstreamFile.absolutePath))) {
      throw new Error(`Local controller source differs from the pinned DSH source: ${localFile.relativePath}`)
    }
  }
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
