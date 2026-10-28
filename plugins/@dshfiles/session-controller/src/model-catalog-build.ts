import type { ModelCatalog } from './native/types.ts'

/** Share one bounded catalog build, but never serve a snapshot from an obsolete adapter/default generation. */
export class ModelCatalogBuild {
  private generation = 0
  private kept: { readonly key: string; cachedAt: number; pending: boolean; readonly value: Promise<ModelCatalog> } | undefined

  constructor(
    private readonly key: () => string,
    private readonly build: () => Promise<ModelCatalog>,
    private readonly now = () => performance.now(),
  ) {}

  invalidate(): void {
    this.generation++
    this.kept = undefined
  }

  load(): Promise<ModelCatalog> {
    const key = this.key()
    if (this.kept !== undefined && this.kept.key === key && (this.kept.pending || this.now() - this.kept.cachedAt < 5_000)) return this.kept.value
    const generation = ++this.generation
    const obsolete = (): boolean => generation !== this.generation || key !== this.key()
    const value = Promise.resolve()
      .then(this.build)
      .then(
        catalog => {
          if (obsolete()) return this.load()
          if (this.kept?.value === value) {
            this.kept.pending = false
            this.kept.cachedAt = this.now()
          }
          return catalog
        },
        (error: unknown) => {
          if (obsolete()) return this.load()
          if (this.kept?.value === value) this.kept = undefined
          throw error
        },
      )
    this.kept = { key, cachedAt: this.now(), pending: true, value }
    return value
  }
}
