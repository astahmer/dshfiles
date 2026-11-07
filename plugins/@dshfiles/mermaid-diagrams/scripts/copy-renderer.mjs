// Copies pele's ES module build, and KaTeX's for math labels, into dist/renderer/, which the Host route serves. dshx
// Client builds are a single chunk every page downloads at boot, so the ~270 KB (gzip) renderer cannot live in
// client.js: the Client imports `lazy.js` from the route the first time a diagram shows, pele then fetches only the
// diagram types it renders, and `katex.mjs` (~150 KB gzip) loads only for a diagram with `$$…$$` labels.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(join(root, 'package.json'))
const peleRoot = dirname(require.resolve('pele/package.json'))
const { version } = JSON.parse(readFileSync(join(peleRoot, 'package.json'), 'utf8'))
const source = join(peleRoot, 'dist', 'esm')
const target = join(root, 'dist', 'renderer')
if (!existsSync(join(source, 'lazy.js'))) throw new Error(`pele ${version} has no dist/esm/lazy.js; check the pinned version in package.json.`)
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
cpSync(join(peleRoot, 'LICENSE'), join(target, 'LICENSE'))
const katexRoot = dirname(require.resolve('katex/package.json'))
const katexVersion = JSON.parse(readFileSync(join(katexRoot, 'package.json'), 'utf8')).version
if (!existsSync(join(katexRoot, 'dist', 'katex.mjs'))) throw new Error(`katex ${katexVersion} has no dist/katex.mjs; check the pinned version in package.json.`)
cpSync(join(katexRoot, 'dist', 'katex.mjs'), join(target, 'katex.mjs'))
cpSync(join(katexRoot, 'LICENSE'), join(target, 'KATEX-LICENSE'))
console.log(`copied pele ${version} and katex ${katexVersion} to dist/renderer`)
