import type { ProcessTree } from './types.js'

/**
 * A job whose owning thread is mid-turn is left to that thread's own Stop: killing it from here fails the turn. Every
 * other listed tree is fair game for a bulk stop, which is how a pile of older threads' leftovers goes at once.
 */
export const bulkStoppable = (trees: readonly ProcessTree[]): ProcessTree[] => trees.filter(tree => !(tree.origin === 'job' && tree.ownerRunning))
