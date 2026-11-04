import type {} from '@deepseek-ai/dsh-plugin-manager'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Ref } from 'effect'
import { bundleLabelsOf, type BundleLabel } from './bundle-labels.js'

/**
 * Settings page labels, read once per set of Loader rows. Core's `listBundles` re-reads every plugin's manifest and
 * locale files synchronously on each call, which blocked the Host for about a second on every page load; the labels
 * only change when rows are added, removed or replaced.
 */
export class BundleLabels extends Context.Service<BundleLabels, { readonly read: Effect.Effect<readonly BundleLabel[]> }>()(
  '@dshfiles/settings-shell/BundleLabels',
) {
  static readonly layer = Layer.effect(
    BundleLabels,
    Effect.gen(function* () {
      const host = yield* HostContext
      const cached = yield* Ref.make(Option.none<{ readonly rows: string; readonly labels: readonly BundleLabel[] }>())
      const loadedRows = (): string => [...(host.ctx.get('loader')?.entries() ?? [])].map(entry => `${entry.id}:${String(entry.options.name)}`).join('\n')
      const read = Effect.gen(function* () {
        const rows = loadedRows()
        const current = yield* Ref.get(cached)
        if (Option.isSome(current) && current.value.rows === rows) return current.value.labels
        const manager = host.ctx.get('pluginManager')
        if (manager === undefined) return []
        // An unreadable profile leaves the pages on their schema titles; the next read tries again.
        const bundles = yield* Effect.option(Effect.tryPromise(() => manager.listBundles()))
        if (Option.isNone(bundles)) return []
        const labels = bundleLabelsOf(bundles.value)
        yield* Ref.set(cached, Option.some({ rows, labels }))
        return labels
      }).pipe(Effect.withSpan('settings-shell bundle labels read'))
      return BundleLabels.of({ read })
    }),
  )
}
