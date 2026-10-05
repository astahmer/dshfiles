import type { ButtonHTMLAttributes, ReactNode } from 'react'

export * from '@dshfiles/plugin-ui/testing/host-primitives'

export const Pill = ({ active: _active, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; children?: ReactNode }): JSX.Element => (
  <button type="button" {...rest}>
    {children}
  </button>
)
