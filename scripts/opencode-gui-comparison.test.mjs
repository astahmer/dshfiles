import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'

const page = new URL('../docs/research/harness-landscape/opencode.md', import.meta.url)
const seedUrl = new URL('../profiles/web/package.json', import.meta.url)
const readJson = url => JSON.parse(readFileSync(url, 'utf8'))
const links = text => [...text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)]
const stockVoice = 'https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.2/docs/subsystems/voice-input.md'

// All seven issue examples, with the store/toggle and board/scheduler examples split out.
const requiredEvidence = {
  'GitHub panel': 'jujutsu/revision-graph',
  'Inline PR review and agent hand-off': 'diffs-review/diff-line-comments',
  'Per-chat notes and checklist': 'agent-plan/plan-card',
  'Side chats': 'btw/btw-side-chat',
  'Plugin store': 'capabilities-hub/capabilities-hub',
  'Header toggle and skill picker': 'settings-shell/plugin-enablement-tools',
  'Offline voice prompts': stockVoice,
  'Global kanban': 'backlog/board-links-and-history',
  'Deferred prompts': 'queue-reorder/send-later',
  'Cron jobs': 'project-automations/project-automations',
}

const featureCitation = (label, target) => {
  const catalog = /^\.\.\/\.\.\/\.\.\/plugins\/@dshfiles\/([^/]+)\/dshx\.features\.json$/.exec(target)
  return catalog ? { plugin: catalog[1], id: label } : undefined
}

test('OpenCode GUI comparison cites current DSH features and web seed bundles', () => {
  const markdown = readFileSync(page, 'utf8')
  const section = markdown.split(/^## /m).find(section => section.startsWith('Community GUI plugins\n'))
  assert.ok(section, 'Missing the Community GUI plugins comparison')

  const rows = new Map()
  for (const [, name, openCode, dsh] of section.matchAll(/^\| \*\*([^*]+)\.\*\* ([^\n]+?) \| ([^\n]+) \|$/gm)) {
    assert.ok(!rows.has(name), `Duplicate comparison row: ${name}`)
    assert.ok(
      links(openCode).some(([, , target]) => target.startsWith('https://github.com/')),
      `${name} needs an OpenCode project source`,
    )
    rows.set(
      name,
      links(dsh).map(([, label, target]) => {
        const citation = featureCitation(label, target)
        return citation ? `${citation.plugin}/${citation.id}` : target
      }),
    )
  }
  assert.deepEqual(
    Object.entries(requiredEvidence).filter(([name, evidence]) => !rows.get(name)?.includes(evidence)),
    [],
    'Missing comparison rows or DSH evidence',
  )

  const seed = readJson(seedUrl)
  for (const [, label, target] of links(section)) {
    if (!target.startsWith('../')) continue
    const url = new URL(target, page)
    assert.ok(statSync(url, { throwIfNoEntry: false })?.isFile(), `Missing local source: ${target}`)
    const citation = featureCitation(label, target)
    if (!citation) continue

    const bundle = `@dshfiles/${citation.plugin}`
    assert.ok(seed.dependencies[bundle] && seed.dsh.profile.bundles.includes(bundle), `${bundle} is no longer in the web seed`)
    assert.ok(
      readJson(url).features.some(feature => feature.id === citation.id),
      `${bundle} has no feature ID ${citation.id}`,
    )
  }
})
