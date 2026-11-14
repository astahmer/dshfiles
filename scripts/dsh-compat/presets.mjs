/**
 * Saved agent presets across a DSH core upgrade.
 *
 * A user's agent presets are `@deepseek-ai/dsh-agent-preset` rows: the Web
 * preset editor saved them into the profile's `cordis.patch.yml` (an `insert`
 * of a new row, or an override keyed by a shipped row's id), and Creator mode
 * authors them as bundles installed into the profile. Each row lists child
 * plugin rows by module specifier. A core upgrade can remove or rename one of
 * those modules or one of its options; the registry then marks the preset
 * broken and every new thread on it fails.
 *
 * This module finds those presets, migrates the references a known upgrade
 * changed, and validates every remaining reference against the new core:
 *
 * 1. Known changes are explicit rules with the version that introduced them.
 *    A rule edits only the row it matches; every other byte of the file stays
 *    as written (comments, `!!js` expressions, quoting, custom settings),
 *    because edits are spliced into the source text at the parsed node ranges
 *    instead of re-serializing the document.
 * 2. Every child reference is then resolved with Node's own ESM resolver from
 *    the bases the Loader uses, and checked for compatibility with the new
 *    core (official module versions, `engines.dsh`, Cordis peer range).
 *    A reference no rule explains is an actionable error, never a silent drop.
 * 3. Writing backs up each changed file next to itself first and replaces it
 *    atomically.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// The same dependency owner `cli.mjs` uses for playwright: dshx declares yaml and semver.
const toolRequire = createRequire(join(HERE, '..', '..', 'tooling', 'dshx', 'packages', 'dshx', 'package.json'))
const YAML = toolRequire('yaml')
const semver = toolRequire('semver')

const PRESET_MODULE = '@deepseek-ai/dsh-agent-preset'
const REGISTRY_ROW = 'agent-preset-registry'
const SUBAGENT_CONTROL = '@deepseek-ai/dsh-tool-subagent-control'
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: source => source, identify: () => false }

const parse = source => YAML.parseDocument(source, { customTags: [JS_TAG] })

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

const isInside = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.startsWith('/'))
}

// ── text splicing ────────────────────────────────────────────────────────────

const lineStart = (source, offset) => source.lastIndexOf('\n', offset - 1) + 1
const lineEnd = (source, offset) => {
  const index = source.indexOf('\n', offset)
  return index === -1 ? source.length : index + 1
}
/** End of the line holding the last character before `offset` (block collections already end after their newline). */
const through = (source, offset) => (offset > 0 && source[offset - 1] === '\n' ? offset : lineEnd(source, offset))
const indentOf = (source, offset) => offset - lineStart(source, offset)
const pairOf = (map, key) => map.items.find(pair => YAML.isScalar(pair.key) && pair.key.value === key)
const quote = value => `'${value.replaceAll("'", "''")}'`

class RewriteError extends Error {}

/** Remove one block-sequence item (`- id: …` through its last value line). */
const deleteItem = (source, item) => {
  if (YAML.isMap(item) && item.flow) throw new RewriteError('the row is written in flow style')
  return { start: lineStart(source, item.range[0]), end: through(source, item.range[1]), text: '' }
}

/** Replace one `key: value` pair of a block map by other lines at the same indentation. */
const replacePair = (source, map, key, lines) => {
  const pair = pairOf(map, key)
  if (map.flow) {
    if (lines.length === 0) throw new RewriteError('the option sits in a flow-style map')
    return { start: pair.key.range[0], end: pair.value.range[1], text: lines.join(', ') }
  }
  const start = lineStart(source, pair.key.range[0])
  const indent = ' '.repeat(indentOf(source, pair.key.range[0]))
  return { start, end: through(source, pair.value.range[1]), text: lines.map(line => `${indent}${line}\n`).join('') }
}

/** Insert lines after one pair of a block map, at that pair's indentation. */
const insertAfterPair = (source, map, key, lines) => {
  if (map.flow) throw new RewriteError('the row is written in flow style')
  const pair = pairOf(map, key)
  const at = through(source, pair.value.range[1])
  const indent = ' '.repeat(indentOf(source, pair.key.range[0]))
  return { start: at, end: at, text: lines.map(line => `${indent}${line}\n`).join('') }
}

const replaceScalar = (node, text) => ({ start: node.range[0], end: node.range[1], text })

const singleLineSource = (source, node) => {
  const text = source.slice(node.range[0], node.range[1])
  if (text.includes('\n')) throw new RewriteError('the option value spans several lines')
  return text
}

const applyEdits = (source, edits) => {
  const ordered = [...edits].sort((a, b) => b.start - a.start)
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].end > ordered[index - 1].start) throw new RewriteError('two migrations edit the same lines')
  }
  return ordered.reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source)
}

// ── preset discovery ─────────────────────────────────────────────────────────

const isPresetRow = node => YAML.isMap(node) && node.get('name') === PRESET_MODULE

/** Preset rows of one patch document, with where each sits. */
const presetRowsOf = doc => {
  const rows = []
  const root = doc.contents
  if (!YAML.isSeq(root)) return rows
  root.items.forEach((entry, index) => {
    if (!YAML.isMap(entry)) return
    const insert = entry.get('insert', true)
    if (YAML.isSeq(insert)) {
      insert.items.forEach((row, inner) => {
        if (isPresetRow(row)) rows.push({ row, where: `[${String(index)}].insert[${String(inner)}]` })
      })
      return
    }
    const rowId = String(entry.get('id') ?? '')
    const overridesPreset = rowId.startsWith('preset-') && YAML.isSeq(entry.getIn(['config', 'plugins'], true))
    if (isPresetRow(entry) || overridesPreset) rows.push({ row: entry, where: `[${String(index)}]` })
  })
  return rows
}

const presetIdOf = row => {
  const declared = row.getIn(['config', 'id'])
  if (typeof declared === 'string' && declared.length > 0) return declared
  const rowId = String(row.get('id') ?? '')
  return rowId.startsWith('preset-') ? rowId.slice('preset-'.length) : rowId
}

/**
 * Files that can hold the user's presets: the profile patch, and the patches of
 * every non-official bundle the profile lists. Official bundles ship with the
 * core and are migrated by it. A bundle is writable only when it lives inside
 * the profile (Creator installs); a linked source checkout is validated and its
 * errors name the file to fix there.
 */
const presetSources = profileDir => {
  const profile = realpathSync(profileDir)
  const sources = [{ owner: 'profile', file: join(profile, 'cordis.patch.yml'), base: profile, writable: true }]
  const manifest = readJson(join(profile, 'package.json'))
  for (const name of manifest?.dsh?.profile?.bundles ?? []) {
    if (typeof name !== 'string' || name.startsWith('@deepseek-ai/')) continue
    const directory = join(profile, 'node_modules', name)
    if (!existsSync(join(directory, 'package.json'))) continue
    const real = realpathSync(directory)
    const patches = readJson(join(real, 'package.json'))?.dsh?.bundle?.patch
    for (const patch of [patches ?? []].flat()) {
      if (typeof patch !== 'string') continue
      sources.push({ owner: `bundle ${name}`, file: resolve(real, patch), base: real, writable: isInside(profile, real) })
    }
  }
  return sources.filter(source => existsSync(source.file))
}

/** Presets something selects: the registry default and saved default, and each configured Agent's preset. */
const selectedPresets = ({ docs, home }) => {
  const selected = new Map()
  const add = (id, reason) => {
    if (typeof id !== 'string' || id.length === 0) return
    selected.set(id, [...(selected.get(id) ?? []), reason])
  }
  for (const doc of docs) {
    if (!YAML.isSeq(doc.contents)) continue
    for (const entry of doc.contents.items) {
      if (!YAML.isMap(entry) || entry.get('id') !== REGISTRY_ROW) continue
      add(entry.getIn(['config', 'default']), 'registry default')
      add(entry.getIn(['config', 'selectedDefault']), 'saved default')
    }
  }
  const stored = home === undefined ? undefined : readJson(join(home, 'storages', 'agents.json'))
  const agents = [stored ?? []].flat().find(part => part !== null && typeof part === 'object' && part.agents !== undefined)?.agents ?? {}
  for (const agent of Object.values(agents)) add(agent?.preset, `agent @${String(agent?.handle ?? '?')}`)
  return selected
}

/** The ids of a profile's saved presets and of the presets something selects, without resolving anything. */
const savedPresetIds = ({ profileDir, home }) => {
  const docs = presetSources(profileDir).flatMap(source => {
    const doc = parse(readFileSync(source.file, 'utf8'))
    return doc.errors.length === 0 ? [doc] : []
  })
  return {
    saved: [...new Set(docs.flatMap(doc => presetRowsOf(doc).map(({ row }) => presetIdOf(row))))],
    selected: [...selectedPresets({ docs, home }).keys()],
  }
}

/** Every child row of a preset, groups included, with its path and the list that holds it. */
const childRows = (plugins, path = 'plugins') => {
  if (!YAML.isSeq(plugins)) return []
  return plugins.items.flatMap((row, index) => {
    if (!YAML.isMap(row)) return []
    const here = `${path}[${String(index)}]`
    const config = row.get('config', true)
    const nested = YAML.isSeq(config) && (row.get('name') === 'cordis:group' || row.get('group') === true) ? childRows(config, `${here}.config`) : []
    return [{ row, container: plugins, path: here }, ...nested]
  })
}

const rowLabel = row => (row.get('id') === undefined ? String(row.get('name')) : `${String(row.get('id'))} (${String(row.get('name'))})`)

// ── known upgrade changes ────────────────────────────────────────────────────

/**
 * Known preset breakages, each with the first core version that has it. A rule
 * applies when the upgrade crosses that version. `apply` returns the edits and
 * one sentence saying what changed and why.
 */
const PRESET_RULES = [
  {
    id: 'list-agents-merged',
    since: '0.2.2-0',
    match: row => row.get('name') === `${SUBAGENT_CONTROL}/list-agents`,
    apply: ({ source, row, allRows }) => {
      const hasControl = allRows.some(other => other.row.get('name') === SUBAGENT_CONTROL)
      if (hasControl) {
        return {
          edits: [deleteItem(source, row)],
          change: `removed ${rowLabel(row)}: the module is gone in 0.2.2 and list_agents now registers with ${SUBAGENT_CONTROL}, which this preset already loads`,
        }
      }
      const edits = [replaceScalar(row.get('name', true), quote(SUBAGENT_CONTROL))]
      if (row.get('config') === undefined) edits.push(insertAfterPair(source, row, 'name', ['config:', '  interrupt: false']))
      return {
        edits,
        change: `renamed ${rowLabel(row)} to ${SUBAGENT_CONTROL}: list_agents moved there in 0.2.2; it also adds send_message, interrupt stays off`,
      }
    },
  },
  {
    id: 'subagent-model-selection-split',
    since: '0.2.2-0',
    match: row =>
      /(^|\/)(dsh-)?tool-subagent$/.test(String(row.get('name'))) &&
      YAML.isMap(row.get('config', true)) &&
      pairOf(row.get('config', true), 'modelSelectionSettings') !== undefined,
    apply: ({ source, row }) => {
      const config = row.get('config', true)
      const value = singleLineSource(source, pairOf(config, 'modelSelectionSettings').value)
      const lines = []
      if (pairOf(config, 'modelSelection') === undefined) lines.push(`modelSelection: ${value}`)
      if (pairOf(config, 'modelDiscovery') === undefined) lines.push(`modelDiscovery: ${value}`)
      const edit = lines.length === 0 ? replacePair(source, config, 'modelSelectionSettings', []) : replacePair(source, config, 'modelSelectionSettings', lines)
      return {
        edits: [edit],
        change: `${rowLabel(row)}: modelSelectionSettings: ${value} became ${lines.length === 0 ? 'the modelSelection/modelDiscovery already set' : lines.join(', ')} (0.2.2 split the option)`,
      }
    },
  },
  {
    id: 'tool-presentation-executors',
    since: '0.2.2-0',
    match: row => row.get('name') === '@deepseek-ai/dsh-agent-tool-presentation',
    apply: ({ source, row }) => {
      const config = row.get('config', true)
      const mode = YAML.isMap(config) ? config.get('mode') : undefined
      const executor = { ptc: '@deepseek-ai/dsh-tool-executor-ptc', native: '@deepseek-ai/dsh-tool-executor-native' }[mode]
      if (executor === undefined) throw new RewriteError(`its mode ${JSON.stringify(mode)} is neither "native" nor "ptc"`)
      const onlyMode = config.items.length === 1
      const edits = [replaceScalar(row.get('name', true), quote(executor))]
      edits.push(onlyMode ? replacePair(source, row, 'config', []) : replacePair(source, config, 'mode', []))
      return { edits, change: `${rowLabel(row)}: replaced the deprecated tool-presentation mode ${mode} by ${executor}` }
    },
  },
]

const crosses = (since, from, to) => semver.gte(to, since) && (from === undefined || semver.lt(from, since))

// ── reference validation ─────────────────────────────────────────────────────

/** Resolve specifiers with Node's ESM resolver from several bases, in one process. */
const resolveSpecifiers = (pairs, { node = process.execPath } = {}) => {
  if (pairs.length === 0) return []
  const program = `
const pairs = JSON.parse(process.argv[1])
const out = []
for (const { specifier, bases } of pairs) {
  let hit = null
  const tried = []
  for (const base of bases) {
    try { hit = fileURLToPath(import.meta.resolve(specifier, pathToFileURL(base + '/__dsh_preset_probe.mjs'))); break }
    catch (error) { tried.push(base + ': ' + String(error.code ?? error.message)) }
  }
  out.push({ specifier, file: hit, tried })
}
process.stdout.write(JSON.stringify(out))`
  const result = spawnSync(
    node,
    [
      '--experimental-import-meta-resolve',
      '--no-warnings',
      '--input-type=module',
      '-e',
      `import { pathToFileURL, fileURLToPath } from 'node:url';${program}`,
      JSON.stringify(pairs),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.status !== 0) throw new Error(`resolving preset modules failed: ${result.stderr.slice(0, 600)}`)
  return JSON.parse(result.stdout)
}

const packageNameOf = specifier => {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const manifestFor = (file, name) => {
  for (let directory = dirname(file); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = readJson(join(directory, 'package.json'))
    if (manifest?.name === name) return manifest
  }
  return undefined
}

/** The core package directory, its version and its Cordis version, from a pnpm global root or the package itself. */
const coreAt = coreRoot => {
  const candidates = [join(coreRoot, 'node_modules', '@deepseek-ai', 'dsh'), coreRoot]
  const directory = candidates.find(path => readJson(join(path, 'package.json'))?.name === '@deepseek-ai/dsh')
  if (directory === undefined) throw new Error(`no @deepseek-ai/dsh package at ${coreRoot}`)
  const real = realpathSync(directory)
  const version = readJson(join(real, 'package.json')).version
  let cordis
  try {
    cordis = readJson(createRequire(join(real, 'package.json')).resolve('@deepseek-ai/cordis/package.json'))?.version
  } catch {
    cordis = undefined
  }
  return { directory: real, version, cordis }
}

const incompatibility = (manifest, specifier, core) => {
  const name = manifest.name
  if (name.startsWith('@deepseek-ai/dsh') && manifest.version !== core.version) {
    return `${specifier} resolves to ${name}@${manifest.version}, but the core is ${core.version}; official modules must match the core version`
  }
  const engine = manifest.engines?.dsh
  if (typeof engine === 'string' && !semver.satisfies(core.version, engine, { includePrerelease: true })) {
    return `${name}@${manifest.version} declares engines.dsh ${engine}, which excludes ${core.version}`
  }
  const cordis = manifest.peerDependencies?.['@deepseek-ai/cordis']
  if (core.cordis !== undefined && typeof cordis === 'string' && !semver.satisfies(core.cordis, cordis, { includePrerelease: true })) {
    return `${name}@${manifest.version} needs @deepseek-ai/cordis ${cordis}, but the core runs ${core.cordis}`
  }
  return undefined
}

// ── plan and write ───────────────────────────────────────────────────────────

/**
 * Plan the migration of every saved preset of a profile onto `coreRoot`.
 * Nothing is written: `sources[].migrated` holds the new text of each file a
 * rule changed. `errors` lists every reference that no rule explains and that
 * does not resolve or is incompatible; an upgrade must refuse while it is
 * non-empty.
 */
const planPresetMigration = ({ profileDir, coreRoot, from, to, home, node }) => {
  const core = coreAt(coreRoot)
  const target = to ?? core.version
  const sources = presetSources(profileDir).map(source => ({ ...source, original: readFileSync(source.file, 'utf8') }))
  const changes = []
  const errors = []
  const warnings = []
  // DSH composes every bundle layer, then the profile patch, and a later row with the same id replaces an earlier row's
  // whole config. Only the last row per id runs; an earlier one is never mounted, so it is neither migrated nor validated.
  const superseded = new Set()
  const lastByKey = new Map()
  for (const source of [...sources.slice(1), sources[0]]) {
    if (source === undefined) continue
    const doc = parse(source.original)
    if (doc.errors.length > 0) continue
    for (const { row, where } of presetRowsOf(doc)) {
      const key = String(row.get('id') ?? `preset-${presetIdOf(row)}`)
      const previous = lastByKey.get(key)
      if (previous !== undefined) {
        superseded.add(`${previous.source.file}|${previous.where}`)
        warnings.push({
          source: previous.source.file,
          preset: presetIdOf(row),
          message: `${previous.source.file} ${previous.where}: row ${key} is replaced by a later row in ${source.file} ${where} and never runs; delete it to keep one definition`,
        })
      }
      lastByKey.set(key, { source, where })
    }
  }
  const runs = (source, where) => !superseded.has(`${source.file}|${where}`)
  for (const source of sources) {
    const doc = parse(source.original)
    if (doc.errors.length > 0) {
      errors.push({
        source: source.file,
        message: `${source.file} is not valid YAML (${doc.errors[0].message}); fix it or restore its backup before upgrading`,
      })
      source.presets = []
      continue
    }
    const edits = []
    for (const { row, where } of presetRowsOf(doc).filter(({ where }) => runs(source, where))) {
      const preset = presetIdOf(row)
      const allRows = childRows(row.getIn(['config', 'plugins'], true))
      for (const child of allRows) {
        const rule = PRESET_RULES.find(candidate => crosses(candidate.since, from, target) && candidate.match(child.row))
        if (rule === undefined) continue
        try {
          const applied = rule.apply({ source: source.original, row: child.row, container: child.container, allRows })
          edits.push(...applied.edits)
          changes.push({ source: source.file, owner: source.owner, preset, rule: rule.id, path: `${where}.config.${child.path}`, change: applied.change })
        } catch (error) {
          if (!(error instanceof RewriteError)) throw error
          errors.push({
            source: source.file,
            preset,
            message: `preset "${preset}" (${source.file}, ${where}.config.${child.path}): ${rowLabel(child.row)} needs the "${rule.id}" migration, but ${error.message}; edit that row by hand as the rule describes, then rerun`,
          })
        }
      }
    }
    if (edits.length > 0) {
      try {
        source.migrated = applyEdits(source.original, edits)
      } catch (error) {
        if (!(error instanceof RewriteError)) throw error
        errors.push({ source: source.file, message: `${source.file}: ${error.message}; migrate its presets by hand` })
      }
      if (source.migrated !== undefined && parse(source.migrated).errors.length > 0) {
        errors.push({ source: source.file, message: `${source.file}: the migrated text does not parse; nothing was written, migrate its presets by hand` })
        delete source.migrated
      }
      if (source.migrated !== undefined && !source.writable) {
        errors.push({
          source: source.file,
          message: `${source.owner} is a linked checkout (${source.file}); apply the listed preset migrations there, rebuild it, then rerun`,
        })
      }
    }
    const text = source.migrated ?? source.original
    source.presets = presetRowsOf(parse(text))
      .filter(({ where }) => runs(source, where))
      .map(({ row, where }) => ({
        id: presetIdOf(row),
        where,
        rows: childRows(row.getIn(['config', 'plugins'], true)),
      }))
  }

  const docs = sources.map(source => parse(source.migrated ?? source.original))
  const selected = selectedPresets({ docs, home })
  const references = []
  for (const source of sources) {
    for (const preset of source.presets) {
      for (const { row, path } of preset.rows) {
        const specifier = row.get('name')
        if (typeof specifier !== 'string' || specifier.startsWith('cordis:')) continue
        const disabled = row.get('disabled') === true
        references.push({ source, preset: preset.id, where: `${preset.where}.config.${path}`, row, specifier, disabled })
      }
    }
  }
  const resolutions = resolveSpecifiers(
    references.map(reference => ({ specifier: reference.specifier, bases: [...new Set([reference.source.base, realpathSync(profileDir), core.directory])] })),
    { node },
  )
  references.forEach((reference, index) => {
    const { file, tried } = resolutions[index]
    const at = `preset "${reference.preset}" (${reference.source.file}, ${reference.where}, row ${rowLabel(reference.row)})`
    let problem
    if (file === null) {
      problem = `${reference.specifier} does not resolve against dsh ${core.version} (tried ${tried.join('; ')})`
    } else {
      const manifest = manifestFor(file, packageNameOf(reference.specifier))
      if (manifest !== undefined) problem = incompatibility(manifest, reference.specifier, core)
    }
    if (problem === undefined) return
    const fix =
      `install a compatible package into the profile (dsh plugin --profile <name> add ${packageNameOf(reference.specifier)}), ` +
      `remove the row from the preset, or point it at the module that replaced it`
    const entry = { source: reference.source.file, preset: reference.preset, specifier: reference.specifier, message: `${at}: ${problem}; ${fix}` }
    // A literally disabled row is never imported, so it cannot break the preset.
    if (reference.disabled) warnings.push(entry)
    else errors.push(entry)
  })

  const userPresets = [...new Set(sources.flatMap(source => source.presets.map(preset => preset.id)))]
  return {
    core: core.version,
    from: from ?? null,
    to: target,
    sources,
    presets: userPresets.map(id => ({ id, selectedBy: selected.get(id) ?? [] })),
    selected: [...selected.keys()],
    changes,
    errors,
    warnings,
  }
}

const stampOf = () => new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)

/**
 * Write every migrated source: copy the original to a dated backup beside it,
 * then replace the file atomically. Refuses while the plan has errors.
 */
const writePresetMigration = (plan, { backup = true } = {}) => {
  if (plan.errors.length > 0) throw new Error(`preset migration has ${String(plan.errors.length)} unresolved error(s); nothing was written`)
  const written = []
  for (const source of plan.sources) {
    if (source.migrated === undefined || !source.writable) continue
    if (readFileSync(source.file, 'utf8') !== source.original) throw new Error(`${source.file} changed since it was planned; rerun the migration`)
    let backupFile = null
    if (backup) {
      backupFile = `${source.file}.before-presets-${plan.from ?? 'unknown'}-to-${plan.to}-${stampOf()}`
      copyFileSync(source.file, backupFile)
    }
    const temporary = `${source.file}.presets-${String(process.pid)}.tmp`
    writeFileSync(temporary, source.migrated)
    renameSync(temporary, source.file)
    written.push({ file: source.file, backup: backupFile })
  }
  return written
}

/** Re-target a plan's writable sources at another profile directory (a staged copy of the same profile). */
const rebasePlan = (plan, fromDir, toDir) => ({
  ...plan,
  sources: plan.sources.map(source =>
    source.writable && isInside(realpathSync(fromDir), source.file) ? { ...source, file: join(toDir, relative(realpathSync(fromDir), source.file)) } : source,
  ),
})

/** Human-readable report lines for a plan. */
const formatPlan = plan => {
  const lines = [`agent presets: dsh ${plan.from ?? '(unknown)'} → ${plan.to}, ${String(plan.presets.length)} saved preset(s)`]
  for (const preset of plan.presets) lines.push(`  preset ${preset.id}${preset.selectedBy.length > 0 ? ` (selected: ${preset.selectedBy.join(', ')})` : ''}`)
  for (const change of plan.changes) lines.push(`  migrate ${change.preset}: ${change.change}`)
  for (const warning of plan.warnings) lines.push(`  warn  ${warning.message}`)
  for (const error of plan.errors) lines.push(`  ERROR ${error.message}`)
  if (plan.changes.length === 0 && plan.errors.length === 0) lines.push('  nothing to migrate; every reference resolves')
  return lines
}

/** Saved agent presets across a core upgrade: plan, validate, write. */
export class PresetMigration {
  static MODULE = PRESET_MODULE
  static RULES = PRESET_RULES
  static plan = planPresetMigration
  static write = writePresetMigration
  static rebase = rebasePlan
  static format = formatPlan
  static savedIds = savedPresetIds
  static sources = presetSources
  static selected = selectedPresets
  static resolve = resolveSpecifiers
  static core = coreAt
}
