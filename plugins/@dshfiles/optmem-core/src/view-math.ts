import { TreeMath } from './tree-math.ts'
import type { NodeAddress, StreamId, ViewKind, ViewState } from './types.ts'
import { Utf8 } from './utf8.ts'

export type ViewLines = {
  readonly nodes: readonly NodeAddress[]
  readonly lines: readonly string[]
  readonly bytes: number
}

export type MergePlan = ViewLines & { readonly merges: number; readonly reachedLower: boolean }

export class ViewMath {
  static escape(text: string): string {
    return text.replace(/\r\n|\r|\n/g, '\\n')
  }

  static line(address: NodeAddress, text: string): string {
    return `${TreeMath.format(address)}| ${ViewMath.escape(text)}`
  }

  /** Bytes a line costs inside the rendered view, newline included. */
  static lineBytes(line: string): number {
    return Utf8.byteLength(line) + 1
  }

  static render(lines: readonly string[]): string {
    return lines.map(line => `${line}\n`).join('')
  }

  static lines(rendered: string): readonly string[] {
    return rendered === '' ? [] : rendered.slice(0, -1).split('\n')
  }

  static empty(stream: StreamId, kind: ViewKind = 'main'): ViewState {
    return { stream, kind, throughPos: 0, nodes: [], rendered: '', bytes: 0, version: 0, mergePending: false }
  }

  /**
   * Best adjacent sibling pair whose parent is built: greatest `due`, ties to the oldest pair.
   * Returns the index of the left node, or -1.
   */
  static pickMergePair(nodes: readonly NodeAddress[], throughPos: number, isParentBuilt: (parent: NodeAddress) => boolean): number {
    let bestIndex = -1
    let bestDue = -Infinity
    for (let index = 0; index + 1 < nodes.length; index++) {
      const left = nodes[index]
      const right = nodes[index + 1]
      if (!left || !right || !TreeMath.areSiblings(left, right)) continue
      if (!isParentBuilt(TreeMath.parent(left))) continue
      const due = TreeMath.due({ level: left.level, lastPos: TreeMath.lastPos(right), throughPos })
      if (due > bestDue) {
        bestDue = due
        bestIndex = index
      }
    }
    return bestIndex
  }

  /**
   * Merges the most due pairs until the view fits in `lowerBytes` or nothing is mergeable. Pure and deterministic:
   * same order as repeatedly applying `pickMergePair`, in O(V log V) because a pair's due is fixed within a batch.
   */
  static planMergeBatch(
    request: ViewLines & {
      readonly throughPos: number
      readonly lowerBytes: number
      readonly nodeText: (address: NodeAddress) => string | undefined
    },
  ): MergePlan {
    const addresses: NodeAddress[] = [...request.nodes]
    const lines: string[] = [...request.lines]
    const previous = addresses.map((_address, index) => index - 1)
    const next = addresses.map((_address, index) => (index + 1 < addresses.length ? index + 1 : -1))
    const alive = addresses.map(() => true)
    const heap = new PairHeap()
    const offer = (left: number): void => {
      const right = left < 0 ? -1 : (next[left] ?? -1)
      const leftAddress = addresses[left]
      const rightAddress = addresses[right]
      if (!leftAddress || !rightAddress || !TreeMath.areSiblings(leftAddress, rightAddress)) return
      const parentText = request.nodeText(TreeMath.parent(leftAddress))
      if (parentText === undefined) return
      const due = TreeMath.due({ level: leftAddress.level, lastPos: TreeMath.lastPos(rightAddress), throughPos: request.throughPos })
      heap.push({ left, right, due, start: TreeMath.start(leftAddress), parentText })
    }
    for (let index = 0; index + 1 < addresses.length; index++) offer(index)
    let bytes = request.bytes
    let merges = 0
    while (bytes > request.lowerBytes) {
      const pair = heap.pop()
      if (!pair) break
      const leftAddress = addresses[pair.left]
      if (!leftAddress || !alive[pair.left] || !alive[pair.right] || next[pair.left] !== pair.right) continue
      const parent = TreeMath.parent(leftAddress)
      const parentLine = ViewMath.line(parent, pair.parentText)
      bytes += ViewMath.lineBytes(parentLine) - ViewMath.lineBytes(lines[pair.left] ?? '') - ViewMath.lineBytes(lines[pair.right] ?? '')
      const merged = addresses.length
      addresses.push(parent)
      lines.push(parentLine)
      alive.push(true)
      alive[pair.left] = false
      alive[pair.right] = false
      const before = previous[pair.left] ?? -1
      const after = next[pair.right] ?? -1
      previous.push(before)
      next.push(after)
      if (before >= 0) next[before] = merged
      if (after >= 0) previous[after] = merged
      merges++
      offer(before)
      offer(merged)
    }
    const head = alive.findIndex((isAlive, index) => isAlive && (previous[index] ?? -1) < 0)
    const resultNodes: NodeAddress[] = []
    const resultLines: string[] = []
    for (let index = head; index >= 0; index = next[index] ?? -1) {
      const address = addresses[index]
      if (address) resultNodes.push(address)
      resultLines.push(lines[index] ?? '')
    }
    return { nodes: resultNodes, lines: resultLines, bytes, merges, reachedLower: bytes <= request.lowerBytes }
  }

  /** Every ancestor that a merge batch over `nodes` could ever need. */
  static mergeAncestors(nodes: readonly NodeAddress[], throughPos: number): readonly NodeAddress[] {
    const result: NodeAddress[] = []
    let level = new Map<string, NodeAddress>()
    for (const node of nodes) level.set(TreeMath.key(node), node)
    while (level.size > 0) {
      const next = new Map<string, NodeAddress>()
      for (const node of level.values()) {
        const parent = TreeMath.parent(node)
        if (TreeMath.isComplete(parent, throughPos)) next.set(TreeMath.key(parent), parent)
      }
      result.push(...next.values())
      level = next
    }
    return result
  }
}

type PairCandidate = { readonly left: number; readonly right: number; readonly due: number; readonly start: number; readonly parentText: string }

/** Max-heap on due, ties to the oldest pair. */
class PairHeap {
  #items: PairCandidate[] = []

  static #before(first: PairCandidate, second: PairCandidate): boolean {
    return first.due > second.due || (first.due === second.due && first.start < second.start)
  }

  push(candidate: PairCandidate): void {
    const items = this.#items
    items.push(candidate)
    let index = items.length - 1
    while (index > 0) {
      const parentIndex = (index - 1) >> 1
      const parent = items[parentIndex]
      if (!parent || !PairHeap.#before(candidate, parent)) break
      items[index] = parent
      index = parentIndex
    }
    items[index] = candidate
  }

  pop(): PairCandidate | undefined {
    const items = this.#items
    const top = items[0]
    const last = items.pop()
    if (!top || !last || items.length === 0) return top
    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      const leftChild = items[leftIndex]
      const rightChild = items[rightIndex]
      const child = rightChild && leftChild && PairHeap.#before(rightChild, leftChild) ? rightChild : leftChild
      if (!child || !PairHeap.#before(child, last)) break
      items[index] = child
      index = child === rightChild ? rightIndex : leftIndex
    }
    items[index] = last
    return top
  }
}
