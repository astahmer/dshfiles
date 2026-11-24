import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useEffect, useState } from 'react'

/**
 * The "N updates" pill over a held list (F3). Its seat is a zero-height sticky strip, so the pill floats over the first
 * row instead of pushing every row down 32 px: the hold exists to keep rows still, and the pill that announces it moved
 * them. It enters with opacity and 4 px of travel in 120 ms and leaves in 100 ms (DESIGN.md › Motion); under reduced
 * motion only the opacity changes. It keeps the last count while it fades out.
 */
export const HeldUpdatesPill = (props: {
  readonly count: number
  readonly label: (count: number) => string
  readonly hint: string
  readonly onShow: () => void
}): JSX.Element => {
  const open = props.count > 0
  const [shown, setShown] = useState(props.count)
  useEffect(() => {
    if (props.count > 0) setShown(props.count)
  }, [props.count])
  const text = props.label(open ? props.count : shown)
  return (
    <div className="dshx:pointer-events-none dshx:sticky dshx:top-0 dshx:z-10 dshx:h-0" data-held-updates-seat="">
      <Button
        size="xs"
        variant="outline"
        data-held-updates=""
        data-state={open ? 'open' : 'closed'}
        aria-hidden={open ? undefined : true}
        tabIndex={open ? undefined : -1}
        className="dshx:pointer-events-auto dshx:absolute dshx:inset-x-0 dshx:top-1 dshx:mx-auto dshx:w-fit dshx:rounded-full dshx:bg-background dshx:tabular-nums dshx:shadow-s1 dshx:transition-[opacity,translate] dshx:duration-(--dshx-duration-fade) dshx:ease-enter dshx:data-[state=closed]:pointer-events-none dshx:data-[state=closed]:-translate-y-1 dshx:data-[state=closed]:opacity-0 dshx:data-[state=closed]:duration-(--dshx-duration-exit) dshx:data-[state=closed]:ease-exit dshx:motion-reduce:transition-opacity"
        aria-label={`${text}. ${props.hint}`}
        onClick={props.onShow}
      >
        {text}
      </Button>
    </div>
  )
}
