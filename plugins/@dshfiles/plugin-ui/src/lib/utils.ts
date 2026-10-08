import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({ prefix: 'dshx' })

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
