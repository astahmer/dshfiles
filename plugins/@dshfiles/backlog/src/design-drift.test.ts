import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const source = fileURLToPath(new URL('.', import.meta.url))
const components = readdirSync(source)
  .filter(name => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
  .map(name => ({ name, lines: readFileSync(`${source}${name}`, 'utf8').split('\n') }))

test('every looping spin or pulse stops under reduced motion', () => {
  const offenders = components.flatMap(file =>
    file.lines.flatMap((line, index) => (/dshx:animate-(spin|pulse)\b/.test(line) && !/motion-(reduce|safe):/.test(line) ? [`${file.name}:${String(index + 1)}`] : [])),
  )
  expect(offenders).toEqual([])
})

test('batch actions keep a focus ring and project cards are bordered without a shadow', () => {
  const bar = readFileSync(`${source}bulk-selection-bar.tsx`, 'utf8')
  expect(bar).toMatch(/const actionClass =[^\n]*\n?[^\n]*dshx:focus-visible:ring/)
  const projects = readFileSync(`${source}projects-view.tsx`, 'utf8')
  expect(projects).not.toMatch(/rounded-xl dshx:border[^"]*shadow-(sm|md|lg)/)
  expect(projects).not.toContain('dshx:hover:shadow-md')
})
