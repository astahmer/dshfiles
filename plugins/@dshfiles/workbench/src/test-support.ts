import { beforeAll } from 'vitest'
import type { WorkbenchTranslate } from './locales.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

export const t: WorkbenchTranslate = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)

export const memoryStorage = () => {
  const values = new Map<string, string>()
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
}
