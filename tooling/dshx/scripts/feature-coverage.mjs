import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DshxFeatureCatalogSchema } from '../packages/dshx/src/project/features.ts'

const argumentsList = process.argv.slice(2)
const mode = argumentsList[0]
const rootIndex = argumentsList.indexOf('--root')
if (rootIndex >= 0 && argumentsList[rootIndex + 1] === undefined) throw new Error('--root needs a directory path.')
if (rootIndex >= 0 && rootIndex !== 1) throw new Error('Pass --root <directory> after the mode.')
if (mode !== '--check' && mode !== '--report') throw new Error('Use --check or --report.')

const workspaceRoot = resolve((rootIndex >= 0 ? argumentsList[rootIndex + 1] : undefined) ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../..'))
const pluginsRoot = resolve(workspaceRoot, 'plugins/@dshfiles')
const featureRoot = resolve(workspaceRoot, 'tooling/dshx/e2e/features')
const isReportMode = mode === '--report'

const isWithin = (root, target) => {
  const relativePath = relative(root, target)
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && relativePath !== ''
}

const readPackageManifest = async packageFile => {
  const source = await readFile(packageFile, 'utf8')
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${packageFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const collectPackages = async () => {
  const entries = await readdir(pluginsRoot, { withFileTypes: true })
  const packages = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const packageRoot = resolve(pluginsRoot, entry.name)
    const packageFile = resolve(packageRoot, 'package.json')
    let manifest
    try {
      manifest = await readPackageManifest(packageFile)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@dshfiles/')) continue
    packages.push({ name: manifest.name, root: packageRoot, manifest })
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name))
}

const collectScenarioTags = async () => {
  const entries = await readdir(featureRoot, { withFileTypes: true })
  const featureFiles = new Set()
  const tags = new Map()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.feature')) continue
    const featureFile = resolve(featureRoot, entry.name)
    featureFiles.add(featureFile)
    const source = await readFile(featureFile, 'utf8')
    for (const line of source.split(/\r?\n/)) {
      if (!/^\s*@/.test(line)) continue
      for (const match of line.matchAll(/@scenario:([a-z0-9][a-z0-9.-]*)/g)) {
        const files = tags.get(match[1]) ?? []
        files.push(featureFile)
        tags.set(match[1], files)
      }
    }
  }
  return { featureFiles, tags }
}

const packages = await collectPackages()
const { featureFiles, tags: scenarioTags } = await collectScenarioTags()
const errors = []
const catalogs = []
const declaredVerificationIds = new Set()
const expectedGherkin = new Map()
const counts = { gherkin: 0, 'unit-test': 0, 'host-test': 0, 'not-applicable': 0 }

for (const plugin of packages) {
  const featureReference = plugin.manifest.dshx?.features
  if (typeof featureReference !== 'string' || featureReference.trim() === '') {
    errors.push(`${plugin.name}: missing package.json dshx.features reference.`)
    continue
  }
  const catalogPath = resolve(plugin.root, featureReference)
  if (!isWithin(plugin.root, catalogPath)) {
    errors.push(`${plugin.name}: dshx.features must stay inside the package.`)
    continue
  }
  let rawCatalog
  try {
    rawCatalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  } catch (error) {
    errors.push(`${plugin.name}: cannot read feature catalog ${featureReference}: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  const parsed = DshxFeatureCatalogSchema.safeParse(rawCatalog)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${plugin.name}: ${featureReference} ${issue.path.join('.')}: ${issue.message}`)
    continue
  }
  const featureIssues = []
  const featureIds = new Set()
  const packageVerificationIds = new Set()
  const prefix = `${plugin.name.slice('@dshfiles/'.length)}.`
  const hasBundleMetadata = typeof plugin.manifest.dsh === 'object' && plugin.manifest.dsh !== null && !Array.isArray(plugin.manifest.dsh)
  if (parsed.data.kind === 'bundle' && !hasBundleMetadata) featureIssues.push('bundle catalog requires package DSH bundle metadata')
  if (parsed.data.kind === 'library' && hasBundleMetadata) featureIssues.push('library catalog cannot be attached to a DSH bundle package')
  if (parsed.data.kind === 'infrastructure' && !hasBundleMetadata) featureIssues.push('infrastructure catalog requires package DSH bundle metadata')
  for (const feature of parsed.data.features) {
    if (featureIds.has(feature.id)) featureIssues.push(`duplicate feature id ${feature.id}`)
    featureIds.add(feature.id)
    const kinds = new Set(feature.verification.map(item => item.kind))
    if (parsed.data.kind === 'bundle' && !kinds.has('gherkin')) featureIssues.push(`bundle feature ${feature.id} needs a Gherkin browser scenario`)
    if (parsed.data.kind === 'library' && !kinds.has('unit-test')) featureIssues.push(`library feature ${feature.id} needs a package unit-test reference`)
    if (parsed.data.kind === 'infrastructure' && !kinds.has('not-applicable')) {
      featureIssues.push(`infrastructure feature ${feature.id} needs an explicit not-applicable rationale`)
    }
    for (const verification of feature.verification) {
      if (!verification.id.startsWith(prefix)) featureIssues.push(`verification ${verification.id} must start with ${prefix}`)
      if (packageVerificationIds.has(verification.id)) featureIssues.push(`verification id ${verification.id} is declared more than once in this package`)
      packageVerificationIds.add(verification.id)
      if (declaredVerificationIds.has(verification.id)) featureIssues.push(`verification id ${verification.id} is not globally unique`)
      declaredVerificationIds.add(verification.id)
      counts[verification.kind] += 1
      if (verification.kind === 'gherkin') {
        const featureFile = resolve(workspaceRoot, verification.featureFile)
        if (!isWithin(featureRoot, featureFile)) featureIssues.push(`Gherkin path ${verification.featureFile} must be inside tooling/dshx/e2e/features`)
        expectedGherkin.set(verification.id, featureFile)
      }
      if (verification.kind === 'unit-test' || verification.kind === 'host-test') {
        const testFile = resolve(workspaceRoot, verification.file)
        if (!isWithin(workspaceRoot, testFile)) {
          featureIssues.push(`test path ${verification.file} must stay inside the repository`)
        } else {
          try {
            const source = await readFile(testFile, 'utf8')
            if (!source.includes(verification.testName)) featureIssues.push(`test reference ${verification.testName} was not found in ${verification.file}`)
          } catch {
            featureIssues.push(`test file ${verification.file} does not exist`)
          }
        }
      }
    }
  }
  if (parsed.data.kind === 'infrastructure' && !parsed.data.features.some(feature => feature.verification.some(item => item.kind === 'unit-test'))) {
    featureIssues.push('infrastructure catalogs need at least one package unit-test reference')
  }
  for (const issue of featureIssues) errors.push(`${plugin.name}: ${issue}`)
  catalogs.push({ ...plugin, catalog: parsed.data })
}

for (const [verificationId, featureFile] of expectedGherkin) {
  const files = scenarioTags.get(verificationId) ?? []
  if (files.length === 0) errors.push(`Declared Gherkin scenario ${verificationId} has no @scenario tag.`)
  if (files.length > 1)
    errors.push(`Gherkin scenario ${verificationId} is tagged more than once: ${files.map(file => relative(workspaceRoot, file)).join(', ')}.`)
  if (files.length === 1 && files[0] !== featureFile)
    errors.push(`Gherkin scenario ${verificationId} is tagged in ${relative(workspaceRoot, files[0])}, expected ${relative(workspaceRoot, featureFile)}.`)
}
for (const featureFile of new Set(expectedGherkin.values())) {
  if (isWithin(featureRoot, featureFile) && !featureFiles.has(featureFile)) {
    errors.push(`Declared Gherkin feature file ${relative(workspaceRoot, featureFile)} is missing from E2E feature discovery.`)
  }
}
for (const { id, featureFile, line } of misplacedTags) {
  errors.push(`Misplaced @scenario:${id} tag in ${relative(workspaceRoot, featureFile)}:${line}; scenario tags must annotate a Scenario or Scenario Outline.`)
}
for (const [verificationId, files] of allScenarioTags) {
  if (!expectedGherkin.has(verificationId)) errors.push(`Orphan @scenario:${verificationId} tag in ${relative(workspaceRoot, files[0])}.`)
}

const featureCount = catalogs.reduce((total, plugin) => total + plugin.catalog.features.length, 0)
const configCount = catalogs.reduce((total, plugin) => total + plugin.catalog.features.reduce((count, feature) => count + feature.configuration.length, 0), 0)

if (isReportMode) {
  process.stdout.write(`# Plugin feature coverage\n\n`)
  process.stdout.write(
    `Packages: ${String(packages.length)}; catalogs: ${String(catalogs.length)}; features: ${String(featureCount)}; configuration options: ${String(configCount)}; Gherkin: ${String(counts.gherkin)}; unit tests: ${String(counts['unit-test'])}; Host tests: ${String(counts['host-test'])}; not applicable: ${String(counts['not-applicable'])}.\n\n`,
  )
  process.stdout.write(`| Package | Feature | Configuration | Verification | External test boundary |\n|---|---|---|---|---|\n`)
  for (const plugin of catalogs) {
    for (const feature of plugin.catalog.features) {
      const verification = feature.verification.map(item => `${item.kind}: \`${item.id}\``).join('; ')
      const external = feature.externalDependencies.map(dependency => `${dependency.id}: ${dependency.deterministicFake}`).join('; ') || 'none'
      process.stdout.write(
        `| ${plugin.name} | ${feature.id}: ${feature.title} | ${feature.configuration.map(option => `\`${option.key}\``).join(', ') || 'none'} | ${verification} | ${external} |\n`,
      )
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`Feature coverage validation failed (${String(errors.length)} issue${errors.length === 1 ? '' : 's'}):\n`)
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${String(packages.length)} package catalogs, ${String(featureCount)} features, ${String(configCount)} configuration options, ${String(counts.gherkin)} Gherkin scenarios, ${String(counts['unit-test'])} unit tests, and ${String(counts['host-test'])} Host tests.\n`,
  )
}
