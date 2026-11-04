import { readFile } from 'node:fs/promises'
import { Effect } from 'effect'

export const read = Effect.promise(() => readFile('x', 'utf8'))
