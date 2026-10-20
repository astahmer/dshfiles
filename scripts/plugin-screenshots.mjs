#!/usr/bin/env node

/**
 * Every plugin that renders UI keeps at least one screenshot: it is the README showcase and the marketplace card, and
 * it has to be refreshed (wholly, or only the screen that changed) after a significant UI change.
 *
 *   node scripts/plugin-screenshots.mjs --check           gate: every UI plugin has one and its README embeds it
 *   node scripts/plugin-screenshots.mjs --missing         the same list, without failing
 *   node scripts/plugin-screenshots.mjs [--only a,b]      capture from a running scratch DSH (pnpm screenshots)
 *   node scripts/plugin-screenshots.mjs --only backlog --feature backlog-mentions
 *
 * A "UI plugin" is a bundle whose catalog in `plugins/@dshfiles/<name>/dshx.features.json` lists a feature with the
 * `client` surface, so the rule is derived from the feature map the plugin already has to keep. Its screenshot lives in
 * `docs/screenshots/<feature-id>.png`, named after the catalog feature the capture walks, and is embedded under the
 * README title. Capture drives the same `reach` steps `dshx dev open` verifies, then `dshx dev shot`, so a screenshot
 * cannot describe a path that no longer exists.
 *
 * `scripts/screenshot-ignore.json` names the bundles that render no user surface, each with its reason; a UI bundle
 * missing its screenshot fails the check instead of landing without a showcase.
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DshxFeatureCatalogSchema } from '../tooling/dshx/packages/dshx/src/project/features.ts'
import { embedScreenshot, gatedPlugins, screenshotProblems, targetFeatures } from './plugin-screenshots-core.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const pluginsRoot = join(repositoryRoot, 'plugins', '@dshfiles')
const screenshotDirectory = 'docs/screenshots'
const dshxCli = join(repositoryRoot, 'tooling', 'dshx', 'packages', 'dshx', 'dist', 'cli', 'bin.js')
const ignoreFile = join(repositoryRoot, 'scripts', 'screenshot-ignore.json')
const imagePattern = /\.(?:png|webp)$/
const largeScreenshotBytes = 1_000_000
const minimumReasonLength = 20

/** The feature a plugin shows first; a plugin listed here captures its own picks unless `--feature` names others. */
const primaryFeatures = {
  'ai-accounts': ['credential-recovery'],
  backlog: ['capture-and-triage'],
  'command-palette': ['action-registry'],
  'input-trigger': ['multiword-at-queries'],
  'jj-integration': ['thread-workspaces-panel'],
}

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    check: { type: 'boolean' },
    missing: { type: 'boolean' },
    only: { type: 'string' },
    feature: { type: 'string', multiple: true },
    name: { type: 'string', default: 'shots' },
    stale: { type: 'boolean' },
    json: { type: 'boolean' },
  },
})

const ignored = existsSync(ignoreFile) ? JSON.parse(readFileSync(ignoreFile, 'utf8')) : {}
for (const [name, reason] of Object.entries(ignored)) {
  if (typeof reason !== 'string' || reason.trim().length < minimumReasonLength)
    throw new Error(`${relative(repositoryRoot, ignoreFile)}: "${name}" needs a reason of at least ${minimumReasonLength} characters.`)
}

const readCatalog = name => {
  const manifest = JSON.parse(readFileSync(join(pluginsRoot, name, 'package.json'), 'utf8'))
  const reference = manifest.dshx?.features
  if (typeof reference !== 'string') return { name, directory: join(pluginsRoot, name) }
  const parsed = DshxFeatureCatalogSchema.safeParse(JSON.parse(readFileSync(join(pluginsRoot, name, reference), 'utf8')))
  if (!parsed.success) throw new Error(`plugins/@dshfiles/${name}/${reference}: ${parsed.error.issues[0]?.message ?? 'invalid catalog'}`)
  return { name, directory: join(pluginsRoot, name), catalog: parsed.data }
}

const plugins = gatedPlugins({
  catalogs: readdirSync(pluginsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readCatalog(entry.name)),
  ignored,
})

const screenshotsOf = plugin => {
  const directory = join(plugin.directory, screenshotDirectory)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter(file => imagePattern.test(file))
    .sort()
    .map(file => ({ directory: screenshotDirectory, file, path: join(directory, file), bytes: statSync(join(directory, file)).size }))
}

const readmeOf = plugin => join(plugin.directory, 'README.md')

const newestSource = plugin => {
  const sources = join(plugin.directory, 'src')
  if (!existsSync(sources)) return 0
  let newest = 0
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else newest = Math.max(newest, statSync(path).mtimeMs)
    }
  }
  walk(sources)
  return newest
}

const kilobytes = bytes => `${Math.round(bytes / 1024)} KB`

const problemsOf = plugin => {
  const readmePath = readmeOf(plugin)
  return screenshotProblems({
    reachable: plugin.reachable.length,
    screenshots: screenshotsOf(plugin),
    readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : undefined,
    sizeLimitBytes: largeScreenshotBytes,
  })
}

const staleness = plugin => {
  const screenshots = screenshotsOf(plugin)
  if (screenshots.length === 0) return undefined
  const newest = Math.max(...screenshots.map(screenshot => statSync(screenshot.path).mtimeMs))
  const source = newestSource(plugin)
  return source > newest ? `src/ changed after the last screenshot (${Math.round((source - newest) / 86_400_000)} day(s) ago)` : undefined
}

const runScratch = args => {
  const result = spawnSync(process.execPath, [dshxCli, 'dev', ...args, '--name', values.name, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 180_000,
  })
  const stdout = result.stdout ?? ''
  try {
    return JSON.parse(stdout.slice(stdout.indexOf('{')))
  } catch {
    return { ok: false, error: { code: 'not-json', message: (result.stderr || stdout).trim().split('\n').slice(-3).join(' ') } }
  }
}

const capture = plugin => {
  const outcome = { plugin: plugin.name, screenshots: [], failures: [] }
  const features = targetFeatures({
    catalog: plugin.catalog,
    picked: values.feature ?? [],
    ...(primaryFeatures[plugin.name] === undefined ? {} : { primary: primaryFeatures[plugin.name] }),
  })
  for (const feature of features) {
    const walked = runScratch(['open', `@dshfiles/${plugin.name}#${feature}`])
    if (walked.ok !== true) {
      const step = walked.data?.steps?.find(candidate => !candidate.ok)
      outcome.failures.push(`${feature}: ${step === undefined ? (walked.error?.message ?? 'open failed') : `${step.step} — ${step.error ?? ''}`}`)
      continue
    }
    const evidence = mkdtempSync(join(tmpdir(), 'dshx-screenshots-'))
    try {
      const shot = runScratch(['shot', '--label', `${plugin.name}-${feature}`, '--out', evidence])
      if (shot.ok !== true || typeof shot.data?.screenshot !== 'string') {
        outcome.failures.push(`${feature}: ${shot.error?.message ?? 'shot failed'}`)
        continue
      }
      const directory = join(plugin.directory, screenshotDirectory)
      mkdirSync(directory, { recursive: true })
      const file = `${feature}.png`
      copyFileSync(shot.data.screenshot, join(directory, file))
      const readmePath = readmeOf(plugin)
      const alt = plugin.catalog.features.find(candidate => candidate.id === feature)?.title ?? feature
      writeFileSync(readmePath, embedScreenshot({ readme: readFileSync(readmePath, 'utf8'), imagePath: `${screenshotDirectory}/${file}`, alt }))
      outcome.screenshots.push({ feature, file, bytes: statSync(join(directory, file)).size })
    } finally {
      rmSync(evidence, { recursive: true, force: true })
    }
  }
  return outcome
}

const selected = (values.only ?? '')
  .split(',')
  .map(name => name.trim().replace(/^@dshfiles\//, ''))
  .filter(Boolean)
const scope = selected.length === 0 ? plugins : plugins.filter(plugin => selected.includes(plugin.name))
const unknown = selected.filter(name => !plugins.some(plugin => plugin.name === name))
if (unknown.length > 0) {
  console.error(`not a UI plugin: ${unknown.join(', ')}\nOne of: ${plugins.map(plugin => plugin.name).join(', ')}`)
  process.exit(2)
}

if (values.check === true || values.missing === true) {
  const rows = scope.map(plugin => ({ plugin, problems: problemsOf(plugin) }))
  const failed = rows.filter(row => row.problems.length > 0)
  if (values.missing === true) for (const row of failed) console.log(`${row.plugin.name}\t${row.problems.join('; ')}`)
  else {
    for (const row of failed) console.error(`FAIL ${row.plugin.name}: ${row.problems.join('; ')}`)
    if (failed.length > 0)
      console.error(
        [
          '',
          `${failed.length} UI plugin(s) without a usable screenshot.`,
          'Start a scratch DSH and capture them:',
          '  dshx dev up --name shots',
          '  pnpm screenshots',
          'Then check again: node --run check:screenshots',
        ].join('\n'),
      )
  }
  if (values.stale === true)
    for (const plugin of scope) {
      const stale = staleness(plugin)
      if (stale !== undefined) console.error(`STALE ${plugin.name}: ${stale}`)
    }
  process.exit(values.missing === true || failed.length === 0 ? 0 : 1)
}

if (!existsSync(dshxCli)) {
  console.error(`missing ${relative(repositoryRoot, dshxCli)}\nBuild it: pnpm exec turbo run build --filter=@dshfiles/dshx`)
  process.exit(2)
}

const doctor = runScratch(['doctor'])
if (doctor.ok !== true) {
  console.error(
    [
      `no healthy scratch DSH named "${values.name}": ${doctor.error?.message ?? doctor.data?.checks?.find(check => !check.ok)?.detail ?? 'doctor failed'}`,
      'Start one, capture, then stop it:',
      `  node ${relative(repositoryRoot, dshxCli)} dev up --name ${values.name}`,
      `  node --run screenshots -- --name ${values.name}`,
      `  node ${relative(repositoryRoot, dshxCli)} dev down --name ${values.name}`,
    ].join('\n'),
  )
  process.exit(2)
}

const results = []
for (const plugin of scope) {
  const outcome = capture(plugin)
  results.push(outcome)
  for (const screenshot of outcome.screenshots)
    console.log(`ok   ${plugin.name}#${screenshot.feature} → ${screenshotDirectory}/${screenshot.file} (${kilobytes(screenshot.bytes)})`)
  for (const failure of outcome.failures) console.error(`FAIL ${plugin.name} ${failure}`)
}

if (values.json === true) console.log(JSON.stringify({ schemaVersion: 1, command: 'screenshots', ok: results.every(result => result.failures.length === 0), data: results }, null, 2))

const failures = results.flatMap(result => result.failures)
const missingReach = scope.filter(plugin => plugin.reachable.length === 0).map(plugin => plugin.name)
if (missingReach.length > 0)
  console.error(`no reach steps, so no screenshot path: ${missingReach.join(', ')}\nAdd "reach" to the plugin's catalog feature (skill maintain-verify-dsh).`)
process.exit(failures.length === 0 && missingReach.length === 0 ? 0 : 1)
