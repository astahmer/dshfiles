import type { JSX, ReactNode } from 'react'

/** A plugin page's top row: the `h1` heading over a one-line description, with the page's badges and actions (`children`) on the right, wrapping below in narrow panes. */
export const PageHeader = (props: { readonly heading: ReactNode; readonly description: ReactNode; readonly children?: ReactNode }): JSX.Element => (
  <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
    <div>
      <h1 className="dshx:text-xl dshx:font-semibold">{props.heading}</h1>
      <p className="dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">{props.description}</p>
    </div>
    <div className="dshx:flex dshx:items-center dshx:gap-2">{props.children}</div>
  </header>
)
