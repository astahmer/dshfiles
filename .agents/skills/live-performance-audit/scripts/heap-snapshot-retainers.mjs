// Offline heap snapshot analysis: what holds a page's bytes. Reads a `.heapsnapshot` (DevTools or
// long-tab-heap-probe.mjs) and prints self size by constructor, retained size by class (dominator tree), the largest
// retained objects with a shortest retainer path from the GC roots, the owners that hold the bytes (the lowest dominator
// retaining at least OWNER_MB) and bytes by the nearest named owner on the shortest path.
// Usage: node --max-old-space-size=4096 heap-snapshot-retainers.mjs <file.heapsnapshot> [top=40]
//   env: OWNER_MB=<n, default 3>  OWNERS=<rows, default 25>  SIGS=<rows, default 40>  PATH_DEPTH=<hops, default 14>
//        PATHS_FOR=<Class,...>    group every instance's shortest retainer path, e.g. PATHS_FOR=Session
//        RETAINERS_OF=<node id,...> RETAINER_DEPTH=<n>  walk who retains one node (ids come from the tables above)
//        EDGES_OF=<node id,...>   list one node's outgoing edges with their retained sizes
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (file === undefined) throw new Error('Usage: heap-snapshot-retainers.mjs <file.heapsnapshot> [top=40]')
const top = Number(process.argv[3] ?? 40)
const buf = readFileSync(file)
const findKey = (key, from = 0) => {
  const i = buf.indexOf(`"${key}":`, from)
  if (i < 0) throw new Error(`missing ${key}`)
  return buf.indexOf(0x5b, i) + 1
}
const numbers = key => {
  let i = findKey(key)
  let out = new Uint32Array(1 << 20)
  let n = 0
  let cur = 0
  let inNum = false
  for (; ; i++) {
    const c = buf[i]
    if (c >= 48 && c <= 57) {
      cur = cur * 10 + (c - 48)
      inNum = true
    } else {
      if (inNum) {
        if (n === out.length) {
          const next = new Uint32Array(out.length * 2)
          next.set(out)
          out = next
        }
        out[n++] = cur
        cur = 0
        inNum = false
      }
      if (c === 0x5d) break
    }
  }
  return out.subarray(0, n)
}
const metaStart = buf.indexOf('"snapshot":')
const nodesAt = buf.indexOf('"nodes":')
const metaText = buf.subarray(metaStart + 11, nodesAt).toString().replace(/,\s*$/, '')
const stringsAt = buf.indexOf('"strings":')
const snap = { snapshot: JSON.parse(metaText), nodes: numbers('nodes'), edges: numbers('edges'), strings: JSON.parse(buf.subarray(stringsAt + 10, buf.lastIndexOf(']') + 1).toString()) }
const meta = snap.snapshot.meta
const NF = meta.node_fields.length
const EF = meta.edge_fields.length
const nodeTypes = meta.node_types[0]
const edgeTypes = meta.edge_types[0]
const nT = meta.node_fields.indexOf('type')
const nName = meta.node_fields.indexOf('name')
const nSelf = meta.node_fields.indexOf('self_size')
const nEdges = meta.node_fields.indexOf('edge_count')
const eT = meta.edge_fields.indexOf('type')
const eName = meta.edge_fields.indexOf('name_or_index')
const eTo = meta.edge_fields.indexOf('to_node')
const nodes = snap.nodes
const edges = snap.edges
const strings = snap.strings
const N = nodes.length / NF
const firstEdge = new Uint32Array(N + 1)
for (let i = 0, e = 0; i < N; i++) {
  firstEdge[i] = e
  e += nodes[i * NF + nEdges] * EF
}
firstEdge[N] = edges.length
const weak = edgeTypes.indexOf('weak')
const shortcut = edgeTypes.indexOf('shortcut')
const typeName = i => nodeTypes[nodes[i * NF + nT]]
const nameOf = i => {
  const t = typeName(i)
  return t === 'object' || t === 'native' || t === 'closure' ? `${t === 'closure' ? 'fn ' : ''}${strings[nodes[i * NF + nName]]}` : `(${t})`
}

// self size by class
const byClass = new Map()
let total = 0
for (let i = 0; i < N; i++) {
  const k = nameOf(i).slice(0, 70)
  const v = byClass.get(k) ?? [0, 0]
  v[0] += 1
  v[1] += nodes[i * NF + nSelf]
  total += nodes[i * NF + nSelf]
  byClass.set(k, v)
}
console.log(`nodes ${N} self total ${(total / 1e6).toFixed(1)} MB`)
console.log('--- self size by class')
for (const [k, [c, b]] of [...byClass].sort((a, b) => b[1][1] - a[1][1]).slice(0, top)) console.log(`${(b / 1e6).toFixed(2).padStart(8)} MB ${String(c).padStart(8)}  ${k}`)

// DFS postorder from root 0 over strong edges
const post = new Int32Array(N).fill(-1)
const order = new Uint32Array(N)
let count = 0
const stack = new Uint32Array(N)
const edgeCursor = new Uint32Array(N)
const visited = new Uint8Array(N)
let sp = 0
stack[sp++] = 0
visited[0] = 1
edgeCursor[0] = firstEdge[0]
while (sp > 0) {
  const v = stack[sp - 1]
  let pushed = false
  while (edgeCursor[v] < firstEdge[v + 1]) {
    const e = edgeCursor[v]
    edgeCursor[v] += EF
    const t = edges[e + eT]
    if (t === weak || t === shortcut) continue
    const w = edges[e + eTo] / NF
    if (!visited[w]) {
      visited[w] = 1
      edgeCursor[w] = firstEdge[w]
      stack[sp++] = w
      pushed = true
      break
    }
  }
  if (!pushed) {
    sp--
    post[v] = count
    order[count++] = v
  }
}
// predecessors
const predCount = new Uint32Array(N + 1)
for (let v = 0; v < N; v++) {
  if (!visited[v]) continue
  for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += EF) {
    const t = edges[e + eT]
    if (t === weak || t === shortcut) continue
    predCount[edges[e + eTo] / NF + 1]++
  }
}
for (let i = 0; i < N; i++) predCount[i + 1] += predCount[i]
const preds = new Uint32Array(predCount[N])
const fill = predCount.slice()
for (let v = 0; v < N; v++) {
  if (!visited[v]) continue
  for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += EF) {
    const t = edges[e + eT]
    if (t === weak || t === shortcut) continue
    const w = edges[e + eTo] / NF
    preds[fill[w]++] = v
  }
}
const idom = new Int32Array(N).fill(-1)
idom[0] = 0
const intersect = (a, b) => {
  while (a !== b) {
    while (post[a] < post[b]) a = idom[a]
    while (post[b] < post[a]) b = idom[b]
  }
  return a
}
let changed = true
let passes = 0
while (changed && passes < 50) {
  changed = false
  passes++
  for (let k = count - 1; k >= 0; k--) {
    const v = order[k]
    if (v === 0) continue
    let d = -1
    for (let p = predCount[v]; p < predCount[v + 1]; p++) {
      const u = preds[p]
      if (idom[u] === -1) continue
      d = d === -1 ? u : intersect(u, d)
    }
    if (d !== -1 && idom[v] !== d) {
      idom[v] = d
      changed = true
    }
  }
}
const retained = new Float64Array(N)
for (let k = 0; k < count; k++) {
  const v = order[k]
  retained[v] += nodes[v * NF + nSelf]
  if (v !== 0 && idom[v] >= 0) retained[idom[v]] += retained[v]
}
console.log(`dominator passes ${passes}, reachable ${count}, root retained ${(retained[0] / 1e6).toFixed(1)} MB`)

// BFS parents for paths
const parent = new Int32Array(N).fill(-1)
const parentEdge = new Int32Array(N).fill(-1)
const queue = new Uint32Array(N)
let qh = 0
let qt = 0
queue[qt++] = 0
parent[0] = 0
while (qh < qt) {
  const v = queue[qh++]
  for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += EF) {
    const t = edges[e + eT]
    if (t === weak || t === shortcut) continue
    const w = edges[e + eTo] / NF
    if (parent[w] === -1) {
      parent[w] = v
      parentEdge[w] = e
      queue[qt++] = w
    }
  }
}
const edgeLabel = e => {
  const t = edgeTypes[edges[e + eT]]
  const n = edges[e + eName]
  return t === 'element' || t === 'hidden' ? `[${n}]` : `.${strings[n]}`
}
const pathOf = v => {
  const limit = Number(process.env.PATH_DEPTH ?? 14)
  const parts = []
  while (v !== 0 && parts.length < limit * 2) {
    parts.push(`${edgeLabel(parentEdge[v])}`)
    parts.push(nameOf(parent[v]).slice(0, 40))
    v = parent[v]
  }
  return parts.reverse().join(' ')
}
// retained by class: sum retained of nodes whose idom is of a different class (top-most per class)
const retByClass = new Map()
for (let v = 1; v < N; v++) {
  if (idom[v] < 0) continue
  const k = nameOf(v).slice(0, 70)
  if (nameOf(idom[v]).slice(0, 70) === k) continue
  retByClass.set(k, (retByClass.get(k) ?? 0) + retained[v])
}
console.log('--- retained by class (outermost instances)')
for (const [k, b] of [...retByClass].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(b / 1e6).toFixed(2).padStart(8)} MB  ${k}`)
// largest non-root-ish objects: skip synthetic/system roots
const cands = []
for (let v = 1; v < N; v++) {
  const t = typeName(v)
  if (t === 'synthetic' || t === 'hidden' || t === 'code') continue
  if (retained[v] > 1e6) cands.push(v)
}
cands.sort((a, b) => retained[b] - retained[a])
console.log('--- largest retained objects')
for (const v of cands.slice(0, top)) console.log(`${(retained[v] / 1e6).toFixed(2).padStart(8)} MB  ${nameOf(v).slice(0, 50)} @${nodes[v * NF + meta.node_fields.indexOf('id')]}\n           ${pathOf(v).slice(-600)}`)
// Partition the heap: every node's self size goes to its lowest dominator ancestor (itself included) that retains at
// least OWNER_MB, which names the owners that actually hold the bytes.
const ownerBytes = Number(process.env.OWNER_MB ?? 3) * 1e6
const isBig = v => v !== 0 && retained[v] >= ownerBytes && typeName(v) !== 'synthetic'
const owned = new Map()
for (let v = 1; v < N; v++) {
  if (idom[v] < 0) continue
  let o = v
  while (o !== 0 && !isBig(o)) o = idom[o]
  owned.set(o, (owned.get(o) ?? 0) + nodes[v * NF + nSelf])
}
console.log(`--- owners (lowest dominator retaining >= ${ownerBytes / 1e6} MB), by bytes they hold directly`)
for (const [o, b] of [...owned].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.OWNERS ?? 25))) {
  console.log(`${(b / 1e6).toFixed(2).padStart(8)} MB (ret ${(retained[o] / 1e6).toFixed(1)})  ${o === 0 ? '(root)' : nameOf(o).slice(0, 50)}\n           ${o === 0 ? '' : pathOf(o).slice(-700)}`)
}
// Shortest-path attribution: every node's self size goes to the nearest ancestor on its BFS path from the roots that has
// a real class name (not a plain Object/Array/closure/context), keyed with the property that leads down from it.
const plain = new Set(['Object', 'Array', '(array)', '(string)', '(concatenated string)', '(sliced string)', 'system / Context', '(hidden)', '(number)', '(object shape)', 'Map', 'Set', '(code)', 'system / ExternalStringData'])
const bySig = new Map()
for (let v = 1; v < N; v++) {
  if (parent[v] < 0) continue
  let c = v
  let below = -1
  let steps = 0
  while (c !== 0 && steps < 40) {
    const n = nameOf(c)
    if (!plain.has(n) && !n.startsWith('fn ') && c !== v) break
    below = c
    c = parent[c]
    steps++
  }
  const sig = c === 0 ? '(root)' : `${nameOf(c).slice(0, 40)} ${below >= 0 ? edgeLabel(parentEdge[below]) : ''}`
  const e = bySig.get(sig) ?? { bytes: 0, sample: c }
  e.bytes += nodes[v * NF + nSelf]
  bySig.set(sig, e)
}
console.log('--- by nearest named owner on shortest path')
for (const [sig, e] of [...bySig].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, Number(process.env.SIGS ?? 40))) console.log(`${(e.bytes / 1e6).toFixed(2).padStart(8)} MB  ${sig}\n           ${e.sample === 0 ? '' : pathOf(e.sample).slice(-500)}`)
if (process.env.PATHS_FOR) {
  const want = new Set(process.env.PATHS_FOR.split(','))
  console.log(`--- shortest retainer paths for ${process.env.PATHS_FOR}`)
  const seen = new Map()
  for (let v = 1; v < N; v++) {
    if (typeName(v) !== 'object' || !want.has(strings[nodes[v * NF + nName]])) continue
    const p = pathOf(v).slice(-900)
    const key = p.replace(/@\d+/g, '').replace(/\.\d+/g, '.N').replace(/\[\d+\]/g, '[N]')
    const e = seen.get(key) ?? { count: 0, retained: 0, example: p }
    e.count++
    e.retained += retained[v]
    seen.set(key, e)
  }
  for (const [, e] of [...seen].sort((a, b) => b[1].count - a[1].count)) console.log(`x${e.count} ret ${(e.retained / 1e6).toFixed(1)} MB\n   ${e.example}`)
}
if (process.env.RETAINERS_OF) {
  const idField = meta.node_fields.indexOf('id')
  const byId = new Map()
  for (let v = 0; v < N; v++) byId.set(nodes[v * NF + idField], v)
  const depth = Number(process.env.RETAINER_DEPTH ?? 6)
  const show = (v, level, seen) => {
    if (level > depth) return
    let shown = 0
    for (let p = predCount[v]; p < predCount[v + 1] && shown < 6; p++) {
      const u = preds[p]
      if (seen.has(u)) continue
      let label = ''
      for (let e = firstEdge[u]; e < firstEdge[u + 1]; e += EF) if (edges[e + eTo] / NF === v) label = edgeLabel(e)
      const uname = nameOf(u)
      console.log(`${'  '.repeat(level)}<- ${uname.slice(0, 60)} @${nodes[u * NF + idField]} via ${label.slice(0, 80)}`)
      shown++
      seen.add(u)
      if (!uname.startsWith('(synthetic)') && !uname.startsWith('Window')) show(u, level + 1, seen)
    }
  }
  for (const id of process.env.RETAINERS_OF.split(',')) {
    const v = byId.get(Number(id))
    console.log(`--- retainers of ${nameOf(v)} @${id}`)
    show(v, 0, new Set([v]))
  }
}
if (process.env.EDGES_OF) {
  const idField = meta.node_fields.indexOf('id')
  const byId = new Map()
  for (let v = 0; v < N; v++) byId.set(nodes[v * NF + idField], v)
  for (const id of process.env.EDGES_OF.split(',')) {
    const v = byId.get(Number(id))
    console.log(`--- edges of ${nameOf(v)} @${id}`)
    let n = 0
    for (let e = firstEdge[v]; e < firstEdge[v + 1] && n < 40; e += EF, n++) {
      const w = edges[e + eTo] / NF
      const val = typeName(w) === 'string' ? JSON.stringify(strings[nodes[w * NF + nName]]).slice(0, 80) : ''
      console.log(`  ${edgeLabel(e).slice(0, 60)} -> ${nameOf(w).slice(0, 50)} @${nodes[w * NF + idField]} ${val} ret ${(retained[w] / 1e3).toFixed(0)}KB`)
    }
  }
}
