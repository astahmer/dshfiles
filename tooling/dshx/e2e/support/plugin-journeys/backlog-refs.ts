import type { Page } from '@playwright/test'
import { Option, Schema } from 'effect'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { profileFor } from '../steps.js'

const detailResult = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ item: Schema.Struct({ id: Schema.Number, ref: Schema.optional(Schema.String) }) }),
})

/**
 * Journeys name items by capture order: `b:1` is the first item the fresh profile captured, whose private id is 1. An
 * item created since short aliases shows a random `b:<ref>` instead, so a step reads that ref from the Host.
 */
export const backlogRef = async (page: Page, ordinal: number): Promise<string> => {
  const call = await connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/backlog', apiId: 'backlog', version: 1 })
  const result = Schema.decodeUnknownOption(detailResult)(await call('get', { id: ordinal }))
  if (Option.isNone(result)) throw new Error(`No backlog item was captured as number ${String(ordinal)} in this journey.`)
  return result.value.value.item.ref ?? String(result.value.value.item.id)
}

/** The `b:<ref>` the UI shows for the n-th captured item. */
export const backlogLabel = async (page: Page, ordinal: number): Promise<string> => `b:${await backlogRef(page, ordinal)}`

/** Journey text with every `b:<n>` capture ordinal written as the item's real `b:<ref>`. */
export const withBacklogRefs = async (page: Page, text: string): Promise<string> => {
  const ordinals = [...new Set([...text.matchAll(/(?<![\w/])b:([1-9]\d*)\b/gu)].map(match => Number(match[1])))]
  // An ordinal no item was captured as yet stays as written: the journey means a reference that names nothing.
  const labels = new Map(
    await Promise.all(ordinals.map(async ordinal => [ordinal, await backlogLabel(page, ordinal).catch(() => `b:${String(ordinal)}`)] as const)),
  )
  return text.replace(/(?<![\w/])b:([1-9]\d*)\b/gu, (token, ordinal: string) => labels.get(Number(ordinal)) ?? token)
}
