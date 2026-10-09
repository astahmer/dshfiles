import type { NodeAddress } from './types.ts'

const addressPattern = /^(\d+)\+(\d+)$/

/** Node (level, idx) covers stream positions [idx·2^level, (idx+1)·2^level). */
export class TreeMath {
  static length(address: NodeAddress): number {
    return 2 ** address.level
  }

  static start(address: NodeAddress): number {
    return address.idx * 2 ** address.level
  }

  static lastPos(address: NodeAddress): number {
    return TreeMath.start(address) + TreeMath.length(address) - 1
  }

  static key(address: NodeAddress): string {
    return `${address.level}:${address.idx}`
  }

  static format(address: NodeAddress): string {
    return `${TreeMath.start(address)}+${TreeMath.length(address)}`
  }

  static parse(value: string): NodeAddress | undefined {
    const match = addressPattern.exec(value.trim())
    if (!match?.[1] || !match[2]) return undefined
    const start = Number(match[1])
    const length = Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length < 1) return undefined
    const level = Math.log2(length)
    if (!Number.isInteger(level) || start % length !== 0) return undefined
    return { level, idx: start / length }
  }

  static parent(address: NodeAddress): NodeAddress {
    return { level: address.level + 1, idx: Math.floor(address.idx / 2) }
  }

  static children(address: NodeAddress): readonly [NodeAddress, NodeAddress] | undefined {
    if (address.level === 0) return undefined
    return [
      { level: address.level - 1, idx: address.idx * 2 },
      { level: address.level - 1, idx: address.idx * 2 + 1 },
    ]
  }

  static sibling(address: NodeAddress): NodeAddress {
    return { level: address.level, idx: address.idx % 2 === 0 ? address.idx + 1 : address.idx - 1 }
  }

  /** `left` and `right` are the two children of one parent, in order. */
  static areSiblings(left: NodeAddress, right: NodeAddress): boolean {
    return left.level === right.level && left.idx % 2 === 0 && right.idx === left.idx + 1
  }

  static isComplete(address: NodeAddress, streamLength: number): boolean {
    return (address.idx + 1) * 2 ** address.level <= streamLength
  }

  /** Merge urgency of a sibling pair: distance of its last position from the head, in units of its level. */
  static due(pair: { readonly level: number; readonly lastPos: number; readonly throughPos: number }): number {
    return (pair.throughPos - pair.lastPos) / 2 ** pair.level
  }

  /** Index of the view node covering `pos`, or -1. */
  static covering(nodes: readonly NodeAddress[], pos: number): number {
    let low = 0
    let high = nodes.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const node = nodes[middle]
      if (!node) return -1
      if (pos < TreeMath.start(node)) high = middle - 1
      else if (pos > TreeMath.lastPos(node)) low = middle + 1
      else return middle
    }
    return -1
  }
}
