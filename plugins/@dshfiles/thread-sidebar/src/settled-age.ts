/**
 * The settle age shown beside the settled banner's label, withheld while it only restates it: "Settled now" beside
 * "This thread is settled." says nothing, while "Settled 2h" dates the thread.
 */
export const settledAgeLabel = (age: string): string | undefined => (age === 'now' ? undefined : age)
