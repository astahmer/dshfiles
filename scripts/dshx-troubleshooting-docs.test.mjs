import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = url => readFileSync(url, 'utf8')
const heading = '## Troubleshooting plugin development'
const fragment = '#troubleshooting-plugin-development'
const compatibility = new URL('../tooling/dshx/docs/compatibility.md', import.meta.url)

for (const path of ['../tooling/dshx/docs/sdk/getting-started.md', '../.agents/skills/dsh-plugin-verify/SKILL.md']) {
  test(`${path} links to the plugin troubleshooting guide`, () => {
    const source = new URL(path, import.meta.url)
    const links = [...read(source).matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => new URL(href, source))
    assert.ok(
      links.some(link => link.href === `${compatibility.href}${fragment}`),
      'Missing troubleshooting link',
    )
    assert.ok(read(compatibility).split(/\r?\n/).includes(heading), 'Troubleshooting anchor does not resolve')
  })
}
