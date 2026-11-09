/**
 * The settle age that titles the settled banner, withheld while it only restates the state: "Settled now" says
 * nothing, while "Settled 2h" dates the thread.
 */
export const settledAgeLabel = (age: string): string | undefined => (age === 'now' ? undefined : age)
