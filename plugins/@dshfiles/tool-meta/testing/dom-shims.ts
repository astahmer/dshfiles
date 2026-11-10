/**
 * jsdom lacks constructable stylesheets, which the diff library builds per mounted file (one shadow root each, its
 * styles adopted). Stubbing the members it uses keeps the real renderer under test instead of mocking it.
 */
if (typeof CSSStyleSheet.prototype.replaceSync !== 'function') {
  // jsdom holds no CSS rules either way, and these tests assert structure rather than styles.
  CSSStyleSheet.prototype.replaceSync = function replaceSync(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    readonly #observed = new Set<Element>()
    observe(target: Element): void {
      this.#observed.add(target)
    }
    unobserve(target: Element): void {
      this.#observed.delete(target)
    }
    disconnect(): void {
      this.#observed.clear()
    }
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly #observed = new Set<Element>()
    observe(target: Element): void {
      this.#observed.add(target)
    }
    unobserve(target: Element): void {
      this.#observed.delete(target)
    }
    disconnect(): void {
      this.#observed.clear()
    }
    takeRecords(): readonly IntersectionObserverEntry[] {
      return []
    }
  }
}
