import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

const readSidebarFile = async (name: string): Promise<string> => readFile(new URL(name, import.meta.url), 'utf8')

test('sidebar rows keep project and age above the thread title', async () => {
  const client = await readSidebarFile('./client.tsx')
  const css = await readSidebarFile('./thread-sidebar.module.css')

  assert.match(client, /className=\{styles\.rowProjectLine\}[\s\S]*className=\{styles\.rowProject\}[\s\S]*styles\.rowTime[\s\S]*className=\{styles\.rowTitle\}/)
  assert.match(css, /\.rowProjectLine\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/)
  assert.match(css, /\.rowTitle\s*\{[^}]*font-size:\s*1rem;/)
})

test('sidebar header starts with project scope and highlights its active thread', async () => {
  const client = await readSidebarFile('./client.tsx')
  const css = await readSidebarFile('./thread-sidebar.module.css')

  assert.match(client, /<header className=\{styles\.header\}>\s*<div className=\{styles\.projectTitleRow\}>\s*<Menu/)
  assert.match(client, /data-selected=\{selectedSession\?\.id === session\.id\}/)
  assert.match(css, /\.row\[data-selected='true'\]/)
})

test('sidebar header customization has no extra toolbar row', async () => {
  const shell = await readSidebarFile('./sidebar-shell.tsx')
  const client = await readSidebarFile('./client.tsx')
  const css = await readSidebarFile('./sidebar-shell.module.css')

  assert.doesNotMatch(shell, /<Button[^>]*>[\s\S]*?text\(props\.t, 'threadSidebarCustomize'\)[\s\S]*?<\/Button>/)
  assert.match(shell, /aria-label=\{text\(props\.t, 'threadSidebarCustomize'\)\}/)
  assert.doesNotMatch(client, /<h2 className=\{styles\.title\}>/)
  assert.match(css, /\.customizeButton\s*\{\s*margin-left:\s*auto;/)
})
