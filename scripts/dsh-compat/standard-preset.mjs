#!/usr/bin/env node
/**
 * The web seed's `preset-standard` row, derived from the core this checkout
 * pins instead of restated by hand.
 *
 * A preset's children are config data, and a patch replaces a row's whole
 * `config`, so changing one child means restating the whole shipped preset.
 * Restated by hand, it drifted twice: 0.2.1 dropped the `{{cwd}}` persona
 * suffix and 0.2.2 removed `tool-subagent-control/list-agents`, and every
 * profile carrying the old copy broke new threads (`agent-preset/invalid`).
 * The copy had also silently lost stock rows.
 *
 * So the row is generated: the stock declaration from the installed
 * `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`, plus the overrides
 * below, each with its reason. It lives inside the seed's managed region,
 * which `profile-sync` reconciles into existing profiles, and
 * `standard-preset.test.mjs` fails whenever the committed row differs from
 * what the pinned core produces, so a core bump cannot leave it stale.
 *
 *   node scripts/dsh-compat/standard-preset.mjs           print the derived block
 *   node scripts/dsh-compat/standard-preset.mjs --write   rewrite it in profiles/web/cordis.patch.yml
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const YAML = createRequire(join(ROOT, 'tooling', 'dshx', 'packages', 'dshx', 'package.json'))('yaml')
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: source => source, identify: () => false }

export const BEGIN = '# BEGIN DERIVED preset-standard (node scripts/dsh-compat/standard-preset.mjs --write)'
export const END = '# END DERIVED preset-standard'

/**
 * Changes to the stock children, by child id. A child id the stock preset no
 * longer has fails generation: the override must be reviewed, never dropped.
 */
export const OVERRIDES = [
  {
    id: 'tool-subagent',
    name: '@dshfiles/tool-subagent',
    reason: 'owned fork: child model routes follow the Subagents setting in running threads (b:rmkm)',
  },
  { id: 'tool-subagent-fork', name: '@dshfiles/tool-subagent', reason: 'the same owned fork for subagent_fork' },
  {
    id: 'tool-ask-user',
    name: '@dshfiles/tool-ask-user',
    config: { mode: 'timed', timeout: 300 },
    reason:
      'owned fork that tells the model the form renders markdown and html previews (b:6); timed mode lets a question stay answerable while the agent works (timeout -1 blocks)',
  },
  {
    id: 'skill-filesystem',
    config: null,
    reason:
      'stock points customSkillDirs at @deepseek-ai/dsh-agent-preset resolved from the patch file; from a profile patch that package does not resolve and the expression would break the whole preset, so this row keeps the default skill directories',
  },
]

const webAppDirectory = (root = ROOT) => {
  const core = realpathSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  return dirname(createRequire(core).resolve('@deepseek-ai/dsh-web-app/package.json'))
}

/** Every child map of a preset's plugin list, groups included. */
const children = seq =>
  (YAML.isSeq(seq) ? seq.items : []).flatMap(item =>
    YAML.isMap(item) ? [item, ...(YAML.isSeq(item.get('config', true)) ? children(item.get('config', true)) : [])] : [],
  )

const quoted = (doc, value) => {
  const node = doc.createNode(value)
  node.type = 'QUOTE_SINGLE'
  return node
}

/** The derived block: marker comments, provenance and the row, as it appears in the seed. */
export const derive = ({ root = ROOT } = {}) => {
  const webApp = webAppDirectory(root)
  const version = JSON.parse(readFileSync(join(webApp, 'package.json'), 'utf8')).version
  const doc = YAML.parseDocument(readFileSync(join(webApp, 'presets', 'standard.patch.yml'), 'utf8'), { customTags: [JS_TAG] })
  const stock = doc.contents.items[0]?.get('insert', true)?.items?.[0]
  if (!YAML.isMap(stock) || stock.get('id') !== 'preset-standard')
    throw new Error(`${webApp}/presets/standard.patch.yml no longer inserts preset-standard; update ${fileURLToPath(import.meta.url)}`)
  const byId = new Map(children(stock.getIn(['config', 'plugins'], true)).map(child => [child.get('id'), child]))
  for (const override of OVERRIDES) {
    const child = byId.get(override.id)
    if (child === undefined)
      throw new Error(`stock preset-standard (dsh-web-app ${version}) has no child "${override.id}"; review its override in ${fileURLToPath(import.meta.url)}`)
    if (override.name !== undefined) child.set('name', quoted(doc, override.name))
    if (override.config === null) child.delete('config')
    else if (override.config !== undefined) child.set('config', doc.createNode(override.config))
  }
  const row = new YAML.Document(null, { customTags: [JS_TAG] })
  row.contents = row.createNode([])
  row.contents.items.push(stock)
  const reasons = OVERRIDES.map(override => `#   ${override.id}: ${override.reason}`)
  const body = row.toString({ lineWidth: 0 }).trimEnd()
  return [
    BEGIN,
    `# Generated from @deepseek-ai/dsh-web-app ${version} presets/standard.patch.yml; do not edit by hand. A patch`,
    "# replaces a row's whole config, so this restates the shipped preset with these changes:",
    ...reasons,
    body,
    END,
  ].join('\n')
}

/** Replace the derived block in a seed patch text. */
export const withDerived = (seed, block) => {
  const start = seed.indexOf(BEGIN)
  const end = seed.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error(`the seed has no ${BEGIN} … ${END} block`)
  return `${seed.slice(0, start)}${block}${seed.slice(end + END.length)}`
}

export const SEED = join(ROOT, 'profiles', 'web', 'cordis.patch.yml')

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const block = derive()
  if (process.argv.includes('--write')) {
    const seed = readFileSync(SEED, 'utf8')
    const next = withDerived(seed, block)
    if (next !== seed) writeFileSync(SEED, next)
    console.log(next === seed ? 'preset-standard is current' : `rewrote preset-standard in ${SEED}`)
  } else process.stdout.write(`${block}\n`)
}
