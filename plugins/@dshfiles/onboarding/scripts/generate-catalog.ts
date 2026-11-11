/**
 * Build the onboarding feature catalog from declarations that are already checked in: every owned plugin's
 * `package.json` description and its `dshx.features.json` (title, summary, destination, current surface, reach steps and
 * the optional `onboarding` block). Each catalog is validated with the dshx feature schema first, so a destination or
 * block this page reads is one `features:check` accepts.
 *
 * Nothing here reads a running Host or the network. Run with `node --experimental-strip-types scripts/generate-catalog.ts`;
 * pass `--check` to fail instead of writing when the checked-in catalog is stale, and `--out <file>` to use another file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Schema from 'effect/Schema'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const repoRoot = join(pluginRoot, '..', '..', '..')
const pluginsDir = join(repoRoot, 'plugins', '@dshfiles')
const outIndex = process.argv.indexOf('--out')
const outArgument = outIndex >= 0 ? process.argv[outIndex + 1] : undefined
const outFile = outArgument ?? join(pluginRoot, 'src', 'generated', 'feature-catalog.ts')
const featureSchemaFile = join(repoRoot, 'tooling', 'dshx', 'packages', 'dshx', 'src', 'project', 'features.ts')

const repoPath = (file: string): string => relative(repoRoot, file).split('\\').join('/')
const read = (file: string): string => readFileSync(file, 'utf8')

interface ParsedReachStep {
  readonly action: string
  readonly by?: string
  readonly name?: string
  readonly value?: string
  readonly key?: string
  readonly seed?: string
  readonly file?: string
}

// SAFETY: features.ts exports featureCatalogIssues as (value: unknown) => readonly string[] and parseReachStep as (step: string) => ParsedReachStep | undefined.
const featureSchema = (await import(pathToFileURL(featureSchemaFile).href)) as {
  // oxlint-disable-next-line antislop/no-unknown-parameters -- the dshx schema check is the decode boundary for each raw catalog.
  readonly featureCatalogIssues: (value: unknown) => readonly string[]
  readonly parseReachStep: (step: string) => ParsedReachStep | undefined
}

/** The dshx grammar's own parse of each step, so the page and the Agent never re-implement it. */
const reachStep = (text: string) => {
  const parsed = featureSchema.parseReachStep(text)
  if (parsed === undefined) throw new Error(`reach step does not parse: ${text}`)
  return {
    text,
    action: parsed.action,
    by: parsed.by ?? null,
    name: parsed.name ?? null,
    value: parsed.value ?? parsed.key ?? parsed.seed ?? parsed.file ?? null,
  }
}

const SUMMARY_LIMIT = 280
const clip = (text: string): string => {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
}

const manifestSchema = Schema.fromJsonString(Schema.Struct({ description: Schema.optional(Schema.Unknown) }))
const jsonSchema = Schema.fromJsonString(Schema.Unknown)
/** The fields read here; the full dshx check runs first, so this only narrows what it already accepted. */
const catalogSchema = Schema.Struct({
  features: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      summary: Schema.String,
      surfaces: Schema.Array(Schema.String),
      destination: Schema.optional(Schema.String),
      currentSurface: Schema.optional(Schema.String),
      reach: Schema.optional(Schema.Array(Schema.String)),
      onboarding: Schema.optional(Schema.Unknown),
    }),
  ),
})

const plugins: unknown[] = []
const features: unknown[] = []
for (const name of readdirSync(pluginsDir).sort()) {
  const packageFile = join(pluginsDir, name, 'package.json')
  if (!existsSync(packageFile)) continue
  const manifest = Schema.decodeUnknownSync(manifestSchema)(read(packageFile))
  const description = typeof manifest.description === 'string' ? clip(manifest.description) : ''
  const catalogFile = join(pluginsDir, name, 'dshx.features.json')
  if (!existsSync(catalogFile)) {
    plugins.push({ name, description, ui: false, features: 0 })
    continue
  }
  const raw = Schema.decodeUnknownSync(jsonSchema)(read(catalogFile))
  const issues = featureSchema.featureCatalogIssues(raw)
  if (issues.length > 0) throw new Error(`${repoPath(catalogFile)} fails the dshx feature schema:\n- ${issues.join('\n- ')}`)
  const catalog = Schema.decodeUnknownSync(catalogSchema)(raw)
  plugins.push({ name, description, ui: catalog.features.some(feature => feature.surfaces.includes('client')), features: catalog.features.length })
  for (const feature of catalog.features) {
    features.push({
      key: `${name}#${feature.id}`,
      plugin: name,
      id: feature.id,
      title: feature.title,
      summary: clip(feature.summary),
      destination: feature.destination ?? 'none',
      currentSurface: feature.currentSurface ?? null,
      reach: (feature.reach ?? []).map(reachStep),
      onboarding: feature.onboarding ?? null,
    })
  }
}

const catalog = {
  schemaVersion: 1,
  generatedFrom: ['plugins/@dshfiles/*/package.json (description)', 'plugins/@dshfiles/*/dshx.features.json'],
  plugins,
  features,
}

const output = `// Generated by scripts/generate-catalog.ts from checked-in declarations; run \`pnpm generate\`, never edit by hand.
import type { FeatureCatalog } from '../catalog-model.js'

export const FEATURE_CATALOG: FeatureCatalog = ${JSON.stringify(catalog, null, 2)}
`

const current = existsSync(outFile) ? read(outFile) : ''
if (process.argv.includes('--check')) {
  if (current !== output) {
    console.error(`${repoPath(outFile)} is stale: run \`pnpm --dir plugins/@dshfiles/onboarding generate\` and commit the result.`)
    process.exit(1)
  }
  console.log(`Onboarding catalog is current (${String(plugins.length)} plugins, ${String(features.length)} features).`)
} else if (current === output) {
  console.log(`Onboarding catalog unchanged (${String(plugins.length)} plugins, ${String(features.length)} features).`)
} else {
  writeFileSync(outFile, output)
  console.log(`Wrote ${repoPath(outFile)} (${String(plugins.length)} plugins, ${String(features.length)} features).`)
}
