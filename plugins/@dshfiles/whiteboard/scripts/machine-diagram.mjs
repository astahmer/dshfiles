#!/usr/bin/env node
// Print every xstate v5 machine a module exports as Mermaid.
//
//   pnpm --dir plugins/@dshfiles/whiteboard run machine-diagram plugins/@dshfiles/editor/src/editor-save-machine.ts
//   pnpm --dir plugins/@dshfiles/whiteboard run machine-diagram --format state plugins/@dshfiles/whiteboard/src/board-sync-machine.ts
//
// Options come before the path: everything after `--` is positional, so `-- <path> --format state` would silently keep
// the flowchart format. `--format flowchart` (default) is what whiteboard_write({ mermaid }) turns into editable
// Excalidraw shapes; `--format state` is a stateDiagram-v2 for Markdown. Paths resolve against the directory pnpm was
// started from. Vite's module runner loads the TypeScript source, so the machine's own imports resolve as in its plugin.
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runnerImport } from 'vite'

const usage = 'Usage: machine-diagram [--format flowchart|state] [--export <name>] <module.ts>'
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { format: { type: 'string', default: 'flowchart' }, export: { type: 'string' } },
})
const [target] = positionals
if (target === undefined || positionals.length > 1 || (values.format !== 'flowchart' && values.format !== 'state')) {
  console.error(`${usage}\nPass options before the path: a flag after \`--\` is read as another path, not an option.`)
  process.exit(2)
}
const base = process.env.INIT_CWD ?? process.cwd()
const modulePath = isAbsolute(target) ? target : resolve(base, target)
const diagramPath = fileURLToPath(new URL('../src/xstate-diagram.ts', import.meta.url))

const isMachine = value =>
  typeof value === 'object' && value !== null && typeof value.id === 'string' && typeof value.root === 'object' && typeof value.transition === 'function'

const [{ module: diagram }, { module: loaded }] = await Promise.all([runnerImport(diagramPath), runnerImport(modulePath)])
const machines = Object.entries(loaded).filter(([name, value]) => isMachine(value) && (values.export === undefined || name === values.export))
if (machines.length === 0) {
  console.error(
    `No exported xstate machine${values.export === undefined ? '' : ` named ${values.export}`} in ${modulePath}. Export the createMachine() result.`,
  )
  process.exit(1)
}
for (const [name, machine] of machines) process.stdout.write(`%% ${name}\n${diagram.machineToMermaid(machine, values.format)}\n`)
