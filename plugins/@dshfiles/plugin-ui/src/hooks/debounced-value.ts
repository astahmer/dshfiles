import { useEffect, useState } from 'react'

/** `value` once it has stopped changing for `delayMs`; search inputs feed this into a query key. */
export const useDebouncedValue = <Value>(options: { readonly value: Value; readonly delayMs: number }): Value => {
  const [debounced, setDebounced] = useState(options.value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(options.value), options.delayMs)
    return () => clearTimeout(timer)
  }, [options.value, options.delayMs])
  return debounced
}
