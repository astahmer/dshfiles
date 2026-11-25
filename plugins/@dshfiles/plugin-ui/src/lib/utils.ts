import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge with the kit prefix and the kit's own theme steps (styles.css `@theme`). Without them it reads
 * `text-heading` as a colour and drops it beside `text-foreground`, and reads `font-title` as a family.
 */
const twMerge = extendTailwindMerge({
  prefix: 'dshx',
  extend: {
    theme: {
      text: ['2xs', 'title', 'heading', 'display', 'query'],
      'font-weight': ['title', 'selected'],
    },
  },
})

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
