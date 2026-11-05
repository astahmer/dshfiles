import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { connectDshxApi } from '../platform/dshx-api.js'

/**
 * A reach step names a backlog item by capture order: `b:#1` is the first item the scratch profile captured. New items
 * show a random `b:<ref>`, so a catalog cannot hard-code it; the step is rewritten with the item's real label before it
 * runs. Plain `b:1` stays literal text (a legacy reference, or words typed into a capture).
 */
const ORDINAL = /(?<![\w/])b:#([1-9]\d*)\b/gu

const ordinalsIn = (step: string): readonly number[] => [...new Set([...step.matchAll(ORDINAL)].map(match => Number(match[1])))]

/** The step with every resolved ordinal written as its label; an ordinal no item has yet reads as `b:<n>`. */
const replaceOrdinals = (step: string, labels: ReadonlyMap<number, string>): string =>
  step.replace(ORDINAL, (_token, ordinal: string) => labels.get(Number(ordinal)) ?? `b:${ordinal}`)

const detailResult = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ item: Schema.Struct({ id: Schema.Number, ref: Schema.optional(Schema.String) }) }),
})

/** Reads the labels of the ordinals a step names from the scratch DSH's backlog; a step without one makes no call. */
const resolve = async (input: { readonly step: string; readonly launchUrl: string }): Promise<string> => {
  const ordinals = ordinalsIn(input.step)
  if (ordinals.length === 0) return input.step
  const call = await connectDshxApi({ url: input.launchUrl, packageId: '@dshfiles/backlog', apiId: 'backlog', version: 1 })
  const entries = await Promise.all(
    ordinals.map(async ordinal => {
      const found = Schema.decodeUnknownOption(detailResult)(await call('get', { id: ordinal }).catch(() => undefined))
      return Option.isNone(found) ? undefined : ([ordinal, `b:${found.value.value.item.ref ?? String(found.value.value.item.id)}`] as const)
    }),
  )
  return replaceOrdinals(input.step, new Map(entries.filter(entry => entry !== undefined)))
}

export class BacklogReachOrdinals {
  static readonly ordinalsIn = ordinalsIn
  static readonly replace = replaceOrdinals
  static readonly resolve = resolve
}
