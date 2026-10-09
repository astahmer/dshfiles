import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

interface StockSessionModule {
  readonly Session: {
    create(id: string, seed: readonly unknown[]): {
      snapshotEvents(): readonly { readonly type: string, readonly ignorable?: boolean }[]
      deriveMessages(): readonly unknown[]
    }
  }
}

// Read-only: the published rc.2 package from the global pnpm install of `dsh` (override with DSH_STOCK_SESSION_LIB).
const findStockSessionLib = (): string | undefined => {
  const override = process.env['DSH_STOCK_SESSION_LIB']
  if (override !== undefined) return existsSync(override) ? override : undefined
  const globalRoot = join(homedir(), '.local/share/pnpm/global/v11')
  if (!existsSync(globalRoot)) return undefined
  return readdirSync(globalRoot)
    .map(install => join(globalRoot, install, 'node_modules/.pnpm'))
    .filter(store => existsSync(store))
    .flatMap(store => readdirSync(store)
      .filter(entry => entry.startsWith('@deepseek-ai+dsh-session@0.2.0-rc.2'))
      .map(entry => join(store, entry, 'node_modules/@deepseek-ai/dsh-session/lib/index.js')))
    .find(path => existsSync(path))
}

const stockSessionLib = findStockSessionLib()

describe.skipIf(stockSessionLib === undefined)('full-mode session log on stock dsh-session', () => {
  it('loads a log containing the fork-only messages-override event', async () => {
    const fork = Session.create(SessionId('stock-load'))
    fork.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const override = fork.append('request/messages-override', { turn: 1, step: 1, originalCount: 5, sentCount: 3, originalBytes: 40_864, sentBytes: 16_989 })
    fork.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(override.ignorable).toBe(true)

    const persisted: unknown[] = JSON.parse(JSON.stringify(fork.snapshotEvents()))
    const stock: StockSessionModule = await import(pathToFileURL(stockSessionLib ?? '').href)
    const restored = stock.Session.create('stock-load', persisted)

    expect(restored.snapshotEvents().slice(0, 3).map(event => event.type)).toEqual(['user/message', 'request/messages-override', 'user/message'])
    expect(restored.snapshotEvents()[1]?.ignorable).toBe(true)
    expect(restored.deriveMessages()).toHaveLength(fork.deriveMessages().length)
  })

})
