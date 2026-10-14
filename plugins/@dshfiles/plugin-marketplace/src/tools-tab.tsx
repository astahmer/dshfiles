import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { dshxRegistryApi, type RegistryListing, type RegistryToolSource } from '@dshfiles/dshx/api'
import { useApi, type PropsLocaleOf } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { RefreshCwIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import type { toolsLocale } from './tools-locales.js'

export type ToolsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocaleOf<typeof toolsLocale>

const SOURCE_LABEL = { api: 'sourceApi', mcp: 'sourceMcp', tool: 'sourceTool' } as const satisfies Record<RegistryToolSource, string>
const SOURCE_VARIANT = { api: 'info', mcp: 'warning', tool: 'muted' } as const satisfies Record<RegistryToolSource, string>

const matches = (needle: string, ...fields: ReadonlyArray<string | undefined>): boolean =>
  needle === '' || fields.some(field => field?.toLowerCase().includes(needle) === true)

const Section = ({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode => (
  <section className="dshx:flex dshx:flex-col dshx:gap-2">
    <h3 className="dshx:text-sm dshx:font-medium">{title}</h3>
    {children}
  </section>
)

export const ToolsTab = ({ t }: ToolsTabProps): ReactNode => {
  const api = useApi(dshxRegistryApi)
  const [search, setSearch] = useState('')
  const catalog = useQuery<RegistryListing>({
    queryKey: ['plugin-marketplace', 'tools'],
    queryFn: ({ signal }) => api.list({}, { signal }),
    retry: false,
  })
  const needle = search.trim().toLowerCase()
  const listing = catalog.data
  const tools = (listing?.tools ?? []).filter(tool => matches(needle, tool.name, tool.description, tool.owner, tool.source))
  const methods = (listing?.apis ?? []).flatMap(served =>
    served.methods
      .filter(entry => matches(needle, served.owner, `${served.id}.${entry.name}`, entry.description, entry.tool))
      .map(entry => ({ key: `${served.owner}/${served.id}.${entry.name}`, owner: served.owner, path: `${served.id}.${entry.name}`, ...entry })),
  )
  const skills = (listing?.skills ?? []).filter(skill => matches(needle, skill.name, skill.description, skill.provider))
  const empty = <p className="dshx:text-sm dshx:text-muted-foreground">{t('noMatch')}</p>
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4" data-testid="tools-tab">
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <h2 className="dshx:text-base dshx:font-semibold">{t('title')}</h2>
          <p className="dshx:text-sm dshx:text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void catalog.refetch()} disabled={catalog.isFetching}>
          <RefreshCwIcon className={cn(catalog.isFetching && 'dshx:animate-spin')} /> {t('refresh')}
        </Button>
      </div>
      <InputGroup className="dshx:h-7">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={t('searchLabel')}
          autoComplete="off"
          placeholder={t('searchPlaceholder')}
          type="search"
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
      </InputGroup>
      {catalog.isPending ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={t('loading')}>
          <Skeleton className="dshx:h-6 dshx:w-full" />
          <Skeleton className="dshx:h-6 dshx:w-full" />
        </div>
      ) : null}
      {catalog.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      ) : null}
      {listing === undefined ? null : (
        <>
          <p className="dshx:text-xs dshx:text-muted-foreground">
            {listing.toolScope === undefined ? t('globalScope') : t('scope', { session: listing.toolScope.sessionId })}
          </p>
          <Section title={t('tools', { count: tools.length })}>
            {tools.length === 0 ? (
              empty
            ) : (
              <Table className="dshx:table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="dshx:w-2/5">{t('name')}</TableHead>
                    <TableHead className="dshx:w-1/5">{t('source')}</TableHead>
                    <TableHead>{t('description')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools.map(tool => (
                    <TableRow key={tool.name}>
                      <TableCell className="dshx:font-mono dshx:text-xs dshx:align-top dshx:whitespace-normal dshx:break-all">{tool.name}</TableCell>
                      <TableCell className="dshx:align-top dshx:whitespace-normal">
                        <div className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-1">
                          <Badge variant={SOURCE_VARIANT[tool.source]}>{t(SOURCE_LABEL[tool.source])}</Badge>
                          {tool.owner === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground dshx:break-all">{tool.owner}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">{tool.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
          <Section title={t('apis', { count: methods.length })}>
            {methods.length === 0 ? (
              empty
            ) : (
              <Table className="dshx:table-fixed">
                <TableBody>
                  {methods.map(entry => (
                    <TableRow key={entry.key}>
                      <TableCell className="dshx:w-2/5 dshx:align-top dshx:whitespace-normal">
                        <div className="dshx:flex dshx:flex-col dshx:gap-1">
                          <span className="dshx:font-mono dshx:text-xs dshx:break-all">{entry.path}</span>
                          <span className="dshx:text-xs dshx:text-muted-foreground dshx:break-all">{entry.owner}</span>
                        </div>
                      </TableCell>
                      <TableCell className="dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">
                        {entry.description ?? t('noDescription')}
                      </TableCell>
                      <TableCell className="dshx:w-28 dshx:align-top">
                        {entry.tool === undefined ? null : (
                          <Badge variant="info" title={entry.tool}>
                            {t('agentTool')}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
          <Section title={t('skills', { count: skills.length })}>
            {skills.length === 0 ? (
              empty
            ) : (
              <Table className="dshx:table-fixed">
                <TableBody>
                  {skills.map(skill => (
                    <TableRow key={`${skill.provider}/${skill.name}`}>
                      <TableCell className="dshx:w-2/5 dshx:font-mono dshx:text-xs dshx:align-top dshx:whitespace-normal dshx:break-all">
                        {skill.name}
                      </TableCell>
                      <TableCell className="dshx:w-1/5 dshx:text-xs dshx:text-muted-foreground dshx:align-top dshx:whitespace-normal">
                        {skill.provider}
                      </TableCell>
                      <TableCell className="dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">{skill.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
