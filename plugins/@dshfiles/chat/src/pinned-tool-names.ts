/** The tool names PinnedToolCalls providers registered, read synchronously while Chat builds tool nodes. */
let pinnedToolNames: ReadonlySet<string> = new Set()

export const setPinnedToolNames = (names: Iterable<string>): void => {
  pinnedToolNames = new Set(names)
}

export const isPinnedToolName = (name: string): boolean => pinnedToolNames.has(name)
