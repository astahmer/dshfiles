/**
 * Applies the workspace-attach fix to a CLONED DSH runtime.
 *
 * In-box bundles resolve from the dsh installation before the profile, so the
 * fix cannot be delivered through a profile link: it has to live in the runtime
 * that will be installed. This patches the built controller in place inside a
 * disposable runtime clone, leaving the live installation untouched.
 *
 * Usage: node scripts/release/patch-runtime-controller.mjs <runtime-root>
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const runtimeRoot = process.argv[2]
if (runtimeRoot === undefined) throw new Error('Provide the runtime root to patch.')
const store = resolve(runtimeRoot, 'node_modules/.pnpm')
const entry = (await readdir(store)).find(name => name.startsWith('@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_'))
if (entry === undefined) throw new Error('controller not found in the runtime')
const libPath = resolve(store, entry, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js')
const original = await readFile(libPath, 'utf8')
if (original.includes('resolveByPath(cwd)')) {
  console.log('already patched')
  process.exit(0)
}
const before = `\t\tif (workspace !== void 0) try {
\t\t\tawait workspace.attachSession(sessionId);`
const after = `\t\tif (workspace !== void 0) try {
\t\t\tconst owner = cwd === workspace.path ? workspace : await this.ctx.workspaceRegistry.resolveByPath(cwd).catch(() => void 0);
\t\t\tawait owner?.attachSession(sessionId);`
if (!original.includes(before)) throw new Error('create attach pattern not found')
let patched = original.replace(before, after)
const forkBefore = `\t\tif (workspace !== void 0) try {
\t\t\tawait workspace.attachSession(childId);`
const forkAfter = `\t\tif (workspace !== void 0) try {
\t\t\tconst owner = childCwd === workspace.path ? workspace : await this.ctx.workspaceRegistry.resolveByPath(childCwd).catch(() => void 0);
\t\t\tawait owner?.attachSession(childId);`
if (patched.includes(forkBefore)) patched = patched.replace(forkBefore, forkAfter)
await writeFile(libPath, patched)
console.log('patched', libPath.replace(store, '<runtime>/.pnpm'))
console.log('create patched:', patched.includes('resolveByPath(cwd)'), '| fork patched:', patched.includes('resolveByPath(childCwd)'))
