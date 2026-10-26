import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { BarChart3Icon, BrainIcon, ChevronDownIcon, FileTextIcon, MessagesSquareIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { memoryApi, type MemoryNoteType } from './api.ts'
import { AnalyticsTab } from './analytics-tab.tsx'
import { MemoryFocusModel } from './memory-focus.ts'
import { NotesTab } from './notes-tab.tsx'
import { PanelFormat } from './panel-format.ts'
import { ThreadsTab } from './threads-tab.tsx'

type MemoryTab = 'notes' | 'threads' | 'analytics'

const memoryTabOf = (value: string): MemoryTab => (value === 'threads' || value === 'analytics' || value === 'notes' ? value : 'notes')

const subtitleOf = (tab: MemoryTab): string => {
  if (tab === 'threads') return 'View and explore thread digests, what was extracted, and which memories were created.'
  if (tab === 'analytics') return 'Usage, performance, and quality metrics for memory extraction and retrieval.'
  return 'What your agents remember, where it comes from, and how it is used.'
}

const projectTrigger =
  'dshx:h-8 dshx:min-w-32 dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-transparent dshx:px-3 dshx:text-xs dshx:font-normal dshx:shadow-none'

const AddMemoryDialog = (props: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly projects: readonly { readonly project: string; readonly notes: number }[]
  readonly defaultProject: string
  readonly onCreated: (noteId: number) => void
}): JSX.Element => {
  const api = useApi(memoryApi)
  const queryClient = useQueryClient()
  const [project, setProject] = useState(props.defaultProject)
  const [text, setText] = useState('')
  const [type, setType] = useState<MemoryNoteType>('project')
  const [scope, setScope] = useState('repo')
  const [confidence, setConfidence] = useState<'stated' | 'inferred'>('stated')
  useEffect(() => {
    if (props.open) setProject(props.defaultProject)
  }, [props.defaultProject, props.open])
  const create = useMutation({
    mutationFn: () => api.createNote({ project, text: text.trim(), type, scope: scope.trim(), confidence }),
    onSuccess: note => {
      void queryClient.invalidateQueries({ queryKey: ['dshfiles-memory'] })
      setText('')
      props.onOpenChange(false)
      props.onCreated(note.id)
    },
  })
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="dshx-root">
        <DialogHeader>
          <DialogTitle className="dshx:text-sm">Add a memory</DialogTitle>
          <DialogDescription>
            One or two sentences an agent should know in later threads. It joins the start block of new threads in the chosen project.
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">
            <span className="dshx:text-muted-foreground">Project</span>
            {/* A fresh profile has no stored project to offer: the first note needs a path typed in. */}
            {props.projects.length === 0 ? (
              <Input
                aria-label="New note project path"
                placeholder="/path/to/project"
                value={project}
                onChange={event => setProject(event.currentTarget.value)}
                className="dshx:h-8"
              />
            ) : (
              <Combobox
                label="Note project"
                matchTriggerWidth
                onValueChange={setProject}
                options={[
                  { value: '', label: 'Choose a project…' },
                  ...props.projects.map(item => ({ value: item.project, label: `${PanelFormat.projectName(item.project)} (${item.notes} notes)` })),
                ]}
                searchAbove={0}
                value={project}
              />
            )}
          </label>
          <div className="dshx:flex dshx:gap-2">
            <label className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:text-xs">
              <span className="dshx:text-muted-foreground">Type</span>
              <Combobox
                label="New note type"
                matchTriggerWidth
                onValueChange={value => setType(PanelFormat.noteToneList().find(tone => tone.value === value)?.value ?? 'project')}
                options={PanelFormat.noteToneList().map(tone => ({ value: tone.value, label: tone.label }))}
                value={type}
              />
            </label>
            <label className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:text-xs">
              <span className="dshx:text-muted-foreground">Scope</span>
              <Input aria-label="New note scope" value={scope} onChange={event => setScope(event.currentTarget.value)} className="dshx:h-8" />
            </label>
          </div>
          <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs">
            <span className="dshx:text-muted-foreground">Confidence</span>
            <Combobox
              label="New note confidence"
              matchTriggerWidth
              onValueChange={value => setConfidence(value === 'inferred' ? 'inferred' : 'stated')}
              options={[
                { value: 'stated', label: 'Stated' },
                { value: 'inferred', label: 'Inferred' },
              ]}
              value={confidence}
            />
          </label>
          <Textarea
            aria-label="New note text"
            placeholder="The durable fact, decision or preference…"
            value={text}
            onChange={event => setText(event.currentTarget.value)}
            rows={3}
          />
          {create.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(create.error, 'The note could not be added.')}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={project === '' || text.trim().length === 0 || scope.trim().length === 0 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Adding…' : 'Add memory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const MemoryPanel = (props: { readonly openThread: (sessionId: string) => void; readonly projectPaths: readonly string[] }): JSX.Element => {
  const api = useApi(memoryApi)
  const [tab, setTab] = useState<MemoryTab>('notes')
  const [project, setProject] = useState('')
  const [days, setDays] = useState(30)
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const focus = useSyncExternalStore(MemoryFocusModel.subscribe, MemoryFocusModel.read, () => null)
  const projects = useQuery({
    queryKey: ['dshfiles-memory', 'projects'],
    queryFn: ({ signal }) => api.projects(undefined, { signal }),
    staleTime: 60_000,
  })
  const usage = useQuery({
    queryKey: ['dshfiles-memory', 'usage', days],
    queryFn: ({ signal }) => api.usage({ days }, { signal }),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  })
  useEffect(() => {
    if (focus === null) return
    setProject('')
    if (focus.id.startsWith('n:')) {
      const id = Number(focus.id.slice(2))
      setTab('notes')
      setSelectedNoteId(Number.isSafeInteger(id) && id > 0 ? id : null)
    } else if (focus.id.startsWith('t:')) {
      setTab('threads')
      setSelectedThreadId(focus.id.slice(2).replace(/^session-/u, ''))
    }
    const timer = window.setTimeout(MemoryFocusModel.clear, 0)
    return () => window.clearTimeout(timer)
  }, [focus])
  useEffect(() => {
    setSelectedNoteId(null)
    setSelectedThreadId(null)
  }, [project])
  const projectItems = useMemo(
    () =>
      props.projectPaths.map(projectPath => {
        const knownProject = projects.data?.find(item => item.project === projectPath)
        return knownProject ?? { project: projectPath, notes: 0, threads: 0 }
      }),
    [projects.data, props.projectPaths],
  )
  const defaultAddProject = useMemo(() => [...projectItems].sort((left, right) => right.notes - left.notes)[0]?.project ?? '', [projectItems])
  const selectedProject = projectItems.find(item => item.project === project)
  const noteCreated = (id: number): void => {
    setTab('notes')
    setSelectedNoteId(id)
  }
  return (
    <TooltipProvider delayDuration={500}>
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:gap-3 dshx:px-5 dshx:pt-5 dshx:pb-2">
        <div className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-2xl dshx:bg-primary/10 dshx:text-primary dshx:ring-1 dshx:ring-primary/15">
          <BrainIcon className="dshx:size-6" />
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <h1 className="dshx:text-xl dshx:font-semibold dshx:leading-tight">Memory</h1>
            {usage.data === undefined ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="dshx:inline-flex">
                    <Badge variant="outline" className="dshx:border-transparent dshx:bg-muted dshx:text-[10px] dshx:text-muted-foreground">
                      {usage.data.retrieval.active === 'hybrid'
                        ? `Retrieval: hybrid (${usage.data.retrieval.model ?? 'embeddings'})`
                        : usage.data.retrieval.requested === 'hybrid'
                          ? 'Retrieval: BM25 (hybrid unavailable)'
                          : 'Retrieval: BM25'}
                    </Badge>
                  </span>
                </TooltipTrigger>
                {usage.data.retrieval.reason === null ? null : <TooltipContent>{usage.data.retrieval.reason}</TooltipContent>}
              </Tooltip>
            )}
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">{subtitleOf(tab)}</p>
        </div>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <Select value={project === '' ? 'all' : project} onValueChange={value => setProject(value === 'all' ? '' : value)}>
            <SelectTrigger aria-label="Memory project" className={projectTrigger} size="sm">
              <SelectValue>
                {selectedProject === undefined ? 'All projects' : `${PanelFormat.projectName(selectedProject.project)} · ${selectedProject.notes}`}
              </SelectValue>
              <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
            </SelectTrigger>
            <SelectContent align="end" className="dshx:max-w-80">
              <SelectItem value="all">All projects</SelectItem>
              {projectItems.map(item => (
                <SelectItem key={item.project} value={item.project}>
                  {PanelFormat.projectName(item.project)} · {item.threads} threads · {item.notes} notes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon /> Add memory
          </Button>
        </div>
      </header>
      <Tabs value={tab} onValueChange={value => setTab(memoryTabOf(value))} className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-0">
        <div className="dshx:px-5">
          <TabsList aria-label="Memory views" variant="line" className="dshx:w-fit dshx:gap-4 dshx:border-b dshx:border-border">
            <TabsTrigger value="notes" className="dshx:gap-1.5 dshx:px-1 dshx:pb-2 dshx:text-sm">
              <FileTextIcon className="dshx:size-4" /> Notes
            </TabsTrigger>
            <TabsTrigger value="threads" className="dshx:gap-1.5 dshx:px-1 dshx:pb-2 dshx:text-sm">
              <MessagesSquareIcon className="dshx:size-4" /> Threads
            </TabsTrigger>
            <TabsTrigger value="analytics" className="dshx:gap-1.5 dshx:px-1 dshx:pb-2 dshx:text-sm">
              <BarChart3Icon className="dshx:size-4" /> Analytics
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="notes" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
          <NotesTab
            project={project === '' ? undefined : project}
            openThread={props.openThread}
            focusNoteId={MemoryFocusModel.noteIdOf(focus)}
            selectedId={selectedNoteId}
            onSelect={setSelectedNoteId}
          />
        </TabsContent>
        <TabsContent value="threads" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
          <ThreadsTab
            project={project === '' ? undefined : project}
            openThread={props.openThread}
            focusThreadId={MemoryFocusModel.threadIdOf(focus)}
            selectedId={selectedThreadId}
            onSelect={setSelectedThreadId}
            openNote={id => {
              setTab('notes')
              setSelectedNoteId(id)
            }}
          />
        </TabsContent>
        <TabsContent value="analytics" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
          <AnalyticsTab
            project={project === '' ? undefined : project}
            days={days}
            onDaysChange={setDays}
            usage={usage.data}
            openThread={props.openThread}
            openNote={id => {
              setTab('notes')
              setSelectedNoteId(id)
            }}
          />
        </TabsContent>
      </Tabs>
      <AddMemoryDialog
        open={adding}
        onOpenChange={setAdding}
        projects={projectItems}
        defaultProject={project === '' ? defaultAddProject : project}
        onCreated={noteCreated}
      />
    </main>
    </TooltipProvider>
  )
}
