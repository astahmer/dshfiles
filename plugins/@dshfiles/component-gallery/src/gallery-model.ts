import type { GalleryCategory, GalleryDemo } from './demos/types.js'

/** Pure gallery logic: filtering and counting, kept out of the React tree so it is unit-tested directly. */
export const GalleryModel = {
  /** Demos whose title, description or import path contain every whitespace-separated word of `query`. */
  filter(demos: readonly GalleryDemo[], query: string): readonly GalleryDemo[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return demos
    return demos.filter(demo => {
      const haystack = `${demo.title} ${demo.description} ${demo.source}`.toLowerCase()
      return words.every(word => haystack.includes(word))
    })
  },
  total(categories: readonly GalleryCategory[]): number {
    return categories.reduce((sum, category) => sum + category.demos.length, 0)
  },
  /** Duplicate demo ids across categories, which would collide as card keys and heading ids. */
  duplicateIds(categories: readonly GalleryCategory[]): readonly string[] {
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const demo of categories.flatMap(category => category.demos)) {
      if (seen.has(demo.id)) dupes.add(demo.id)
      seen.add(demo.id)
    }
    return [...dupes]
  },
}
