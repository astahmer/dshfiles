import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { projectLifecycleApi } from './project-lifecycle-api.js'

/**
 * A project's mark, wherever a project is named: the icon its repository ships (declared in `dsh.project.json` or found
 * at a conventional path), else a stable monogram. The Host resolves and caches it, so a row never scans a checkout.
 */
export const ProjectIcon = (props: {
  readonly path: string
  readonly title?: string | undefined
  readonly className?: string | undefined
}) => {
  const api = useApi(projectLifecycleApi)
  const icon = useQuery({
    queryKey: ['workspace-folder-picker', 'project-icon', props.path, props.title ?? ''],
    queryFn: ({ signal }) => api.icon(props.title === undefined ? { path: props.path } : { path: props.path, title: props.title }, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const box = cn('dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:rounded-[3px]', props.className)
  const data = icon.data
  if (data === undefined) {
    // Before the Host answers (and if it never does) the first letter still says which project this is.
    const initial = props.title?.trim().charAt(0).toLocaleUpperCase() ?? ''
    return (
      <span className={cn(box, 'dshx:bg-muted dshx:text-[9px] dshx:font-semibold dshx:text-muted-foreground')} aria-hidden="true">
        {initial}
      </span>
    )
  }
  if (data.kind === 'image')
    return <img className={cn(box, 'dshx:object-contain')} src={data.value} alt="" aria-hidden="true" data-project-icon-source={data.source} />
  return (
    <span
      className={cn(box, 'dshx:bg-muted dshx:text-[9px] dshx:font-semibold dshx:text-muted-foreground')}
      aria-hidden="true"
      data-project-icon-source="monogram"
    >
      {data.value}
    </span>
  )
}
