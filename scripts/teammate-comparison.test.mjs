import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const report = new URL('docs/research/persistent-agent-teammates.md', root)
const textOf = url => readFileSync(url, 'utf8')

const products = {
  Kiroshi: {
    repo: 'kiroshi-app/kiroshi-monorepo',
    topics: [
      'Agents',
      'Memory and skills',
      'Conversations',
      'Delegation',
      'Missions',
      'Routines',
      'Spaces',
      'Library',
      'Tabs and windows',
      'Applications, secrets and approvals',
      'Clients',
    ],
  },
  Rakazo: {
    repo: 'elie222/rakazo',
    topics: [
      'Persistent teammates',
      'Memory',
      'Routines',
      'Browser use',
      'Desktop computer use',
      'Sandboxes',
      'Group chats',
      'Delegation and subagents',
      'Dashboards and documents',
      'Voice and calls',
      'Clients',
      'Models and integrations',
    ],
  },
}

const splitTable = section =>
  section
    .split('\n')
    .filter(line => line.startsWith('| '))
    .slice(2)
    .map(line =>
      line
        .slice(1, -1)
        .split('|')
        .map(cell => cell.trim()),
    )

const inlineLinks = text => [...text.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)].map(([, url]) => url)
const refs = text => new Map([...text.matchAll(/^\[([^\]\n]+)\]: (\S+)$/gm)].map(([, label, url]) => [label, url]))
const tableFor = (text, product) => {
  const section = text.split(`\n## ${product}\n`)[1]?.split('\n## ')[0]
  assert.ok(section, `missing ${product} mapping`)
  return splitTable(section)
}

const seededBundles = () => new Set(JSON.parse(textOf(new URL('profiles/web/package.json', root))).dsh.profile.bundles)

for (const [product, { repo, topics }] of Object.entries(products)) {
  test(`${product}: every requested topic has a mapping, pinned product evidence and a local DSH source`, () => {
    const text = textOf(report)
    const sources = refs(text)
    const rows = tableFor(text, product)
    assert.deepEqual(
      rows.map(cells => cells[0]),
      topics,
    )
    for (const [topic, productClaim, dshMapping, decision, ...extra] of rows) {
      assert.deepEqual(extra, [], `${product}: unexpected table separator in ${topic}`)
      assert.ok(decision, `${product}: ${topic} has no gap or disposition`)
      const citations = [...productClaim.matchAll(/\[[^\]\n]+\]\[([^\]\n]+)\]/g)].map(([, label]) => sources.get(label))
      assert.ok(citations.length, `${product}: ${topic} has no product evidence`)
      for (const citation of citations) {
        assert.ok(citation?.startsWith(`https://github.com/${repo}/blob/`), `${product}: ${topic} cites the wrong repo or an undefined reference`)
        assert.match(citation.slice(`https://github.com/${repo}/blob/`.length), /^[0-9a-f]{40}\//, `${product}: ${topic} needs a pinned source`)
      }
      const local = inlineLinks(dshMapping).filter(link => link.startsWith('../'))
      assert.ok(local.length, `${product}: ${topic} has no local DSH evidence`)
    }
  })
}

test('local evidence links resolve and bundle labels agree with the web seed', () => {
  const text = textOf(report)
  const bundles = seededBundles()
  const links = inlineLinks(text).filter(link => link.startsWith('./') || link.startsWith('../'))
  for (const link of links) {
    const url = new URL(link, report)
    assert.ok(existsSync(url), `broken local link: ${link}`)
    const lines = /^#L(\d+)(?:-L(\d+))?$/.exec(url.hash)
    if (lines) {
      const start = Number(lines[1])
      const end = Number(lines[2] ?? lines[1])
      assert.ok(start >= 1 && start <= end && end <= textOf(url).trimEnd().split('\n').length, `invalid line range: ${link}`)
    }
  }
  const owners = [...text.matchAll(/\*\*(Seeded|Not seeded):\*\* ((?:\[[a-z0-9-]+\]\([^)]+\)(?:, )?)+)/g)]
  assert.ok(owners.length, 'Missing explicit bundle composition labels')
  for (const [, label, mapping] of owners) {
    for (const [, name] of mapping.matchAll(/\[([a-z0-9-]+)\]\(/g)) {
      assert.ok(existsSync(new URL(`plugins/@dshfiles/${name}/package.json`, root)), `${name}: not an owned bundle`)
      assert.equal(bundles.has(`@dshfiles/${name}`), label === 'Seeded', `${name}: update the web-seed status`)
    }
  }
  assert.match(text, /\*\*Not seeded:\*\* \[thread-share\]/, 'Keep optional thread sharing distinct from seeded artifact editing')
  assert.ok(
    inlineLinks(textOf(new URL('docs/README.md', root))).includes('research/persistent-agent-teammates.md'),
    'Link the comparison from the documentation index',
  )
})

test('both routine mappings separate stock file observation from durable automation', () => {
  const text = textOf(report)
  const sources = refs(text)
  const npm = 'https://cdn.jsdelivr.net/npm/@deepseek-ai/'
  assert.ok(sources.get('stock-fs')?.startsWith(`${npm}dsh-fs@0.2.2-rc.2/`))
  assert.ok(sources.get('stock-workspace-files')?.startsWith(`${npm}dsh-api-workspace-files@0.2.2-rc.2/`))
  for (const product of Object.keys(products)) {
    const [, , stock, gap] = tableFor(text, product).find(([topic]) => topic === 'Routines') ?? []
    assert.match(stock, /\[.*ctx\.fs\.watch.*\]\[stock-fs\]/, product)
    assert.match(stock, /\[.*workspaceFiles\.changes.*\]\[stock-workspace-files\]/, product)
    assert.match(gap, /durable.*receipt/i, product)
  }
  assert.match(text, /File-watch authority follows file-read permission, not project confinement/)
})

test('missions and clients retain stock Goal and separate Desktop composition', () => {
  const text = textOf(report)
  const [, , mission, gap] = tableFor(text, 'Kiroshi').find(([topic]) => topic === 'Missions') ?? []
  assert.match(mission, /\[Goal\]\[stock-goal\]/)
  assert.match(mission, /\[goal-tool\]\(/)
  assert.match(mission, /\[goal-stall-guard\]\(/)
  assert.match(mission, /one objective per Session.*pause.*block.*complete.*round cap/)
  assert.match(gap, /handoff across ticket owners/i)
  const sources = refs(text)
  assert.match(sources.get('stock-desktop') ?? '', /^https:\/\/github\.com\/deepseek-ai\/deepseek-harness\/blob\/[0-9a-f]{40}\/apps\/desktop\/README\.md/)
  for (const product of Object.keys(products)) {
    const [, , stock, disposition] = tableFor(text, product).find(([topic]) => topic === 'Clients') ?? []
    assert.match(stock, /\[Electron Desktop\]\[stock-desktop\].*separate `desktop` profile/, product)
    assert.match(disposition, /Desktop.*web seed.*unverified/, product)
  }
})

test('Rakazo default fan-out is documented but not proposed for DSH', () => {
  const text = textOf(report)
  const [, evidence, , disposition] = tableFor(text, 'Rakazo').find(([topic]) => topic === 'Group chats') ?? []
  assert.match(evidence, /By default.*reaches every bot.*\[Groups guide\]\[r-groups\]/)
  assert.match(disposition, /do not copy default fan-out/)
})

test('the automations comparison follows the trigger and destination contracts', () => {
  const source = textOf(new URL('plugins/@dshfiles/project-automations/src/automations-api.ts', root))
  const variants = schema => {
    const body = source.split(`export const ${schema} = Schema.Union([`)[1]?.split('\n])')[0]
    assert.ok(body, `inspect the current ${schema} contract and update the comparison check`)
    return [...body.matchAll(/kind: Schema.Literal\('([^']+)'\)/g)].map(([, kind]) => kind).sort()
  }
  const text = textOf(report)
  for (const product of Object.keys(products)) {
    const mapping = tableFor(text, product).find(([topic]) => topic === 'Routines')?.[2]
    assert.ok(mapping)
    for (const [schema, label] of [
      ['triggerDraftSchema', 'Triggers'],
      ['destinationSchema', 'Destinations'],
    ]) {
      const claim = new RegExp(`${label}: ([^.]+)\\.`).exec(mapping)?.[1]
      assert.ok(claim, `${product}: ${label} must name the Host contract variants`)
      assert.deepEqual([...claim.matchAll(/`([^`]+)`/g)].map(([, kind]) => kind).sort(), variants(schema), `${product}: ${label} changed`)
    }
  }
})
