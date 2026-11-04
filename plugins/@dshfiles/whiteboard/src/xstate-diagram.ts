/**
 * Renders an xstate v5 machine as Mermaid text, without importing xstate: it reads the live `machine.root` state
 * node tree (`states`, `initial`, `transitions`, `always`, `invoke`), which every v5 machine exposes.
 *
 * - `flowchart` is what `whiteboard_write({ mermaid })` turns into editable Excalidraw shapes: mermaid-to-excalidraw
 *   converts flowcharts natively and would only paste a state diagram as a picture.
 * - `state` is a `stateDiagram-v2` for Markdown (GitHub and most viewers render it).
 */

/** The parts of an xstate v5 `TransitionDefinition` the diagram reads. */
/** A guard by name, a referenced guard (`{ type }`), or an inline guard function (labelled by its `name`). */
export type DiagramGuard = string | { readonly type: string } | ((...args: never[]) => boolean)

export interface DiagramTransition {
  readonly eventType: string
  readonly target?: ReadonlyArray<{ readonly id: string }> | undefined
  readonly guard?: DiagramGuard | undefined
}

/** The parts of an xstate v5 `StateNode` the diagram reads. */
export interface DiagramStateNode {
  readonly id: string
  readonly key: string
  readonly type: 'atomic' | 'compound' | 'parallel' | 'final' | 'history'
  readonly states: Readonly<Record<string, DiagramStateNode>>
  readonly initial?: { readonly target: ReadonlyArray<{ readonly id: string }> } | undefined
  readonly transitions: ReadonlyMap<string, ReadonlyArray<DiagramTransition>>
  readonly always?: ReadonlyArray<DiagramTransition> | undefined
  readonly invoke?: ReadonlyArray<{ readonly id: string; readonly src: string | object }> | undefined
}

export interface DiagramMachine {
  readonly id: string
  readonly root: DiagramStateNode
}

export type DiagramFormat = 'flowchart' | 'state'

interface Edge {
  readonly from: string
  readonly to: string
  readonly label: string
}

const delayed = /^xstate\.after\.(.+?)\.[^.]+(?:\..+)?$/u
const actorEvent = /^xstate\.(done|error)\.actor\.(.+)$/u

/** Invoked actors by id: xstate names an unnamed invoke `0.<machine>.<state>`, so labels use its `src` instead. */
type ActorNames = ReadonlyMap<string, string>

/** A readable transition label: `EVENT [guard]`, `after 500ms`, `done: save`, `always`. */
const eventLabel = (eventType: string, actors: ActorNames): string => {
  const after = delayed.exec(eventType)
  if (after !== null) return /^\d+$/u.test(after[1] ?? '') ? `after ${after[1] ?? ''}ms` : `after ${after[1] ?? ''}`
  const actor = actorEvent.exec(eventType)
  if (actor !== null) return `${actor[1] === 'done' ? 'done' : 'error'}: ${actors.get(actor[2] ?? '') ?? actor[2] ?? ''}`
  return eventType
}

const guardLabel = (guard: DiagramGuard | undefined): string | null => {
  if (guard === undefined) return null
  const name = guard instanceof Function ? guard.name : guard instanceof Object ? guard.type : guard
  return name === '' ? 'guard' : name
}

const labelOf = (transition: DiagramTransition, eventType: string, actors: ActorNames): string => {
  const guard = guardLabel(transition.guard)
  return guard === null ? eventLabel(eventType, actors) : `${eventLabel(eventType, actors)} [${guard}]`
}

/** A `src` given by name labels the invoke; inline actor logic falls back to the invoke id. */
const sourceName = (invoke: { readonly id: string; readonly src: string | object }): string => (invoke.src instanceof Object ? invoke.id : invoke.src)

/** Mermaid ids are `[A-Za-z0-9_]`; state ids are dotted paths, so map each to a stable unique identifier. */
const idMap = (root: DiagramStateNode): ReadonlyMap<string, string> => {
  const ids = new Map<string, string>()
  const used = new Set<string>()
  const visit = (node: DiagramStateNode): void => {
    const base = `s_${node.id.replace(/[^A-Za-z0-9_]/gu, '_')}`
    let candidate = base
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}_${String(suffix)}`
    used.add(candidate)
    ids.set(node.id, candidate)
    for (const child of Object.values(node.states)) visit(child)
  }
  visit(root)
  return ids
}

const edgesOf = (node: DiagramStateNode, ids: ReadonlyMap<string, string>, actors: ActorNames): Edge[] => {
  const from = ids.get(node.id)
  if (from === undefined) return []
  const own = [...node.transitions.entries()].flatMap(([eventType, transitions]) => transitions.map(transition => ({ eventType, transition })))
  const always = (node.always ?? []).map(transition => ({ eventType: 'always', transition }))
  return [...own, ...always].flatMap(({ eventType, transition }) =>
    (transition.target ?? []).flatMap(target => {
      const to = ids.get(target.id)
      return to === undefined ? [] : [{ from, to, label: labelOf(transition, eventType, actors) }]
    }),
  )
}

const allNodes = (node: DiagramStateNode): DiagramStateNode[] => [node, ...Object.values(node.states).flatMap(allNodes)]

const actorNames = (root: DiagramStateNode): ActorNames =>
  new Map(allNodes(root).flatMap(node => (node.invoke ?? []).map(invoke => [invoke.id, sourceName(invoke)] as const)))

/** Every edge, plus whether any leaves the root itself: a root-level `on` applies in every state. */
const machineEdges = (machine: DiagramMachine, ids: ReadonlyMap<string, string>) => {
  const actors = actorNames(machine.root)
  const edges = allNodes(machine.root).flatMap(node => edgesOf(node, ids, actors))
  const rootId = ids.get(machine.root.id) ?? ''
  return { edges, rootId, fromRoot: edges.some(edge => edge.from === rootId) }
}

/** The pseudo-state root-level transitions start from. */
const ANY_STATE = 'any state'

const quoted = (text: string): string => `"${text.replace(/"/gu, '#quot;')}"`

const invokedNames = (node: DiagramStateNode): string[] => (node.invoke ?? []).map(sourceName)

const stateLabel = (node: DiagramStateNode): string => {
  const invoked = invokedNames(node)
  const suffix = node.type === 'parallel' ? ' (parallel)' : node.type === 'history' ? ' (history)' : ''
  return invoked.length === 0 ? `${node.key}${suffix}` : `${node.key}${suffix}<br/>invoke: ${invoked.join(', ')}`
}

const flowchart = (machine: DiagramMachine): string => {
  const ids = idMap(machine.root)
  const lines = ['flowchart TD']
  const initialMarkers: string[] = []
  const render = (node: DiagramStateNode, depth: number): void => {
    const id = ids.get(node.id) ?? ''
    const indent = '  '.repeat(depth)
    const children = Object.values(node.states)
    const nested = node !== machine.root
    if (children.length === 0) {
      lines.push(`${indent}${id}${node.type === 'final' ? `([${quoted(stateLabel(node))}])` : `[${quoted(stateLabel(node))}]`}`)
      return
    }
    if (nested) lines.push(`${indent}subgraph ${id}[${quoted(stateLabel(node))}]`)
    const inner = nested ? depth + 1 : depth
    const initialTargets = node.type === 'parallel' ? [] : (node.initial?.target ?? [])
    for (const target of initialTargets) {
      const marker = `${id}_initial`
      lines.push(`${'  '.repeat(inner)}${marker}(( ))`)
      initialMarkers.push(`  ${marker} --> ${ids.get(target.id) ?? ''}`)
    }
    for (const child of children) render(child, inner)
    if (nested) lines.push(`${indent}end`)
  }
  render(machine.root, 1)
  const { edges, rootId, fromRoot } = machineEdges(machine, ids)
  if (fromRoot) lines.push(`  ${rootId}{{${quoted(ANY_STATE)}}}`)
  lines.push(...initialMarkers)
  for (const edge of edges) lines.push(`  ${edge.from} -->|${quoted(edge.label)}| ${edge.to}`)
  return `${lines.join('\n')}\n`
}

const stateDiagram = (machine: DiagramMachine): string => {
  const ids = idMap(machine.root)
  const lines = ['stateDiagram-v2']
  const render = (node: DiagramStateNode, depth: number): void => {
    const indent = '  '.repeat(depth)
    const id = ids.get(node.id) ?? ''
    const children = Object.values(node.states)
    const nested = node !== machine.root
    if (nested) lines.push(`${indent}state ${quoted(stateLabel(node).replace('<br/>', ' — '))} as ${id}`)
    if (children.length === 0) return
    if (nested) lines.push(`${indent}state ${id} {`)
    const inner = nested ? depth + 1 : depth
    const innerIndent = '  '.repeat(inner)
    if (node.type === 'parallel') {
      // Each child of a parallel state is one concurrent region, separated by `--`.
      children.forEach((child, index) => {
        if (index > 0) lines.push(`${innerIndent}--`)
        render(child, inner)
      })
    } else {
      for (const target of node.initial?.target ?? []) lines.push(`${innerIndent}[*] --> ${ids.get(target.id) ?? ''}`)
      for (const child of children) {
        render(child, inner)
        if (child.type === 'final') lines.push(`${innerIndent}${ids.get(child.id) ?? ''} --> [*]`)
      }
    }
    if (nested) lines.push(`${indent}}`)
  }
  render(machine.root, 1)
  const { edges, rootId, fromRoot } = machineEdges(machine, ids)
  if (fromRoot) lines.push(`  state ${quoted(ANY_STATE)} as ${rootId}`)
  for (const edge of edges) lines.push(`  ${edge.from} --> ${edge.to} : ${edge.label.replace(/: /gu, ' ').replace(/[:;]/gu, ' ')}`)
  return `${lines.join('\n')}\n`
}

/**
 * Mermaid text for one xstate v5 machine.
 * @param machine - any `createMachine`/`setup().createMachine` result.
 * @param format - `flowchart` (default) for `whiteboard_write({ mermaid })`, `state` for a Markdown `stateDiagram-v2`.
 */
export const machineToMermaid = (machine: DiagramMachine, format: DiagramFormat = 'flowchart'): string =>
  format === 'flowchart' ? flowchart(machine) : stateDiagram(machine)
