// WHATWG timers exist in every runtime the core targets; the ES lib alone does not declare them.
declare function setTimeout(callback: () => void, milliseconds: number): unknown
declare function clearTimeout(handle: unknown): void
