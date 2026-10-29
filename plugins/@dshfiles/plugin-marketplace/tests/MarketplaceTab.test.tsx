// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import type { LocaleDictionaries } from '@dshfiles/dshx/client'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCard, MarketplaceListOutput } from '../src/api.js'
import { zh } from '../src/locales.js'

interface MockSettings {
  readonly hubBaseUrl: string
  readonly defaultSort: 'latest' | 'stars'
  readonly hideIncompatible: boolean
}

/** The injected-settings handle the mocked client reads; its value is set per test. */
interface MockSettingsHandle {
  value: MockSettings | undefined
}

const mocks = vi.hoisted(() => {
  const settings: MockSettingsHandle = { value: undefined }
  return { list: vi.fn(), install: vi.fn(), settings }
})

class RecordingObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin = '0px'
  readonly scrollMargin = '0px'
  readonly thresholds: readonly number[] = [0]
  static readonly instances: RecordingObserver[] = []
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    RecordingObserver.instances.push(this)
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  emit(isIntersecting: boolean): void {
    const rect = new DOMRect()
    this.callback(
      [
        {
          isIntersecting,
          boundingClientRect: rect,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: rect,
          rootBounds: null,
          target: document.body,
          time: 0,
        },
      ],
      this,
    )
  }
}

const installObserver = (): void => {
  RecordingObserver.instances.length = 0
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: RecordingObserver, configurable: true, writable: true })
}

const latestObserver = (): RecordingObserver => {
  const observer = RecordingObserver.instances.at(-1)
  if (observer === undefined) throw new Error('the marketplace did not observe its load-more sentinel')
  return observer
}

const intersectLatestObserver = async (): Promise<void> => {
  await waitFor(() => expect(RecordingObserver.instances.length).toBeGreaterThan(0))
  act(() => latestObserver().emit(true))
}

vi.mock('@dshfiles/dshx/client', () => ({
  defineLocale: (namespace: string, dictionaries: LocaleDictionaries) => ({ namespace, dictionaries }),
  useApi: () => ({ list: mocks.list, install: mocks.install }),
  useSettings: () => mocks.settings,
}))

import { MarketplaceTab, type MarketplaceTabProps } from '../src/MarketplaceTab.js'

function plugin(overrides: Partial<MarketplaceCard> = {}): MarketplaceCard {
  return {
    slug: 'fixture-plugin',
    name: '测试插件',
    packageName: '@fixture/plugin',
    description: '一个用于验证插件市场交互和设置页布局的测试插件。',
    version: '1.0.0',
    compatibilityRange: '>=0.1.0-rc.8',
    compatibility: 'compatible',
    category: 'tools',
    badge: 'community',
    glyph: '测',
    iconUrl: null,
    author: 'fixture-author',
    avatarUrl: null,
    stars: 1200,
    updated: '2026-10-01',
    installed: false,
    ...overrides,
  }
}

function page(overrides: Partial<MarketplaceListOutput> = {}): MarketplaceListOutput {
  return {
    categories: [
      { slug: 'tools', name: '工具' },
      { slug: 'workflow', name: '工作流' },
    ],
    items: [
      plugin(),
      plugin({
        slug: 'community-plugin',
        name: '社区插件',
        packageName: '@fixture/community',
        badge: 'community',
      }),
    ],
    nextCursor: null,
    total: 2,
    ...overrides,
  }
}

const zhMessages = new Map<string, string>(Object.entries(zh))

const t: MarketplaceTabProps['t'] = (key, params) =>
  (zhMessages.get(key) ?? key).replace(/\{([^}]+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))

// SAFETY: the tab component reads only its locale function; every other standard prop is a
// framework-injected hook that this fixture never renders into.
const componentProps = { t } as MarketplaceTabProps

const signalOptions = expect.objectContaining({ signal: expect.any(AbortSignal) })

const renderTab = () =>
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MarketplaceTab {...componentProps} />
    </PluginQueryProvider>,
  )

beforeEach(() => {
  document.documentElement.lang = 'zh-CN'
  mocks.list.mockResolvedValue(page())
  mocks.install.mockResolvedValue({
    status: 'installed',
    packageName: '@fixture/plugin',
    version: '1.0.0',
    restartRequired: true,
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(globalThis, 'IntersectionObserver', { value: undefined, configurable: true, writable: true })
  vi.clearAllMocks()
  mocks.settings.value = undefined
})

const listInputs = (): unknown[] => mocks.list.mock.calls.map(call => call[0])

describe('MarketplaceTab', () => {
  it('sends list inputs without undefined keys, which the dshx API transport rejects', async () => {
    installObserver()
    mocks.list.mockResolvedValueOnce(page({ nextCursor: 'cursor-two' }))
    renderTab()
    expect(await screen.findByText('测试插件')).toBeTruthy()
    await intersectLatestObserver()
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    expect(listInputs()).toStrictEqual([{ locale: 'zh' }, { locale: 'zh', cursor: 'cursor-two' }])
  })

  it('searches the Hub server-side after a debounce and sorts by stars', async () => {
    renderTab()
    await screen.findByText('测试插件')
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchLabel }), { target: { value: '  sidebar  ' } })
    await waitFor(() => expect(listInputs().at(-1)).toStrictEqual({ locale: 'zh', query: 'sidebar' }))
    fireEvent.click(screen.getByRole('radio', { name: zh.sortStars }))
    await waitFor(() => expect(listInputs().at(-1)).toStrictEqual({ locale: 'zh', sort: 'stars', query: 'sidebar' }))
  })

  it('applies the configured default sort and hides incompatible plugins until toggled off', async () => {
    mocks.settings.value = { hubBaseUrl: 'https://hub.example.test', defaultSort: 'stars', hideIncompatible: true }
    mocks.list.mockResolvedValue(page({ items: [plugin(), plugin({ slug: 'future', name: '未来插件', compatibility: 'incompatible' })] }))
    renderTab()
    expect(await screen.findByText('测试插件')).toBeTruthy()
    expect(listInputs()[0]).toStrictEqual({ locale: 'zh', sort: 'stars' })
    expect(screen.queryByText('未来插件')).toBeNull()
    expect(screen.getByText('已隐藏 1 个不兼容插件')).toBeTruthy()
    expect(screen.getByText('浏览并安装 hub.example.test 上发布的插件。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.compatibleOnly }))
    expect(screen.getByText('未来插件')).toBeTruthy()
  })

  it('switches categories through a fresh first-page query and exposes semantic category state', async () => {
    renderTab()
    const tools = await screen.findByRole('button', { name: '工具' })
    expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('true')
    expect(mocks.list).toHaveBeenLastCalledWith({ locale: 'zh' }, signalOptions)
    fireEvent.click(tools)
    expect(tools.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => {
      expect(mocks.list).toHaveBeenLastCalledWith({ locale: 'zh', category: 'tools' }, signalOptions)
    })
  })

  it('renders non-clickable cards and all fixed button states with accessible names', async () => {
    mocks.list.mockResolvedValue(
      page({
        items: [
          plugin({ installed: true }),
          plugin({
            slug: 'unknown',
            name: '待验证插件',
            packageName: '@fixture/unknown',
            compatibility: 'unknown',
          }),
          plugin({
            slug: 'future',
            name: '未来插件',
            packageName: '@fixture/future',
            compatibility: 'incompatible',
          }),
          plugin({
            slug: 'ready',
            name: '可下载插件',
            packageName: '@fixture/ready',
          }),
        ],
      }),
    )
    renderTab()
    const list = await screen.findByRole('list', { name: '插件列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    const button = (name: string): HTMLButtonElement => {
      const element = screen.getByRole('button', { name })
      if (!(element instanceof HTMLButtonElement)) throw new Error(`${name} is not a button`)
      return element
    }
    expect(button('测试插件: 已安装').disabled).toBe(true)
    expect(button('下载 待验证插件').disabled).toBe(false)
    expect(button('下载 未来插件').disabled).toBe(false)
    expect(button('下载 可下载插件').disabled).toBe(false)
    expect(within(list).queryByRole('link')).toBeNull()
  })

  it('requires two confirmations with the fixed risk statement before every download', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '下载 社区插件' }))
    const dialog = screen.getByRole('dialog', { name: '安装插件' })
    expect(within(dialog).getByText('@fixture/community')).toBeTruthy()
    expect(within(dialog).getByText(zh.riskWarning)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '继续' }))
    const risk = screen.getByRole('dialog', { name: '确认风险' })
    expect(within(risk).getByText(zh.riskWarning)).toBeTruthy()
    mocks.list.mockResolvedValue(page({ items: [plugin({ slug: 'community-plugin', name: '社区插件', packageName: '@fixture/community', installed: true })] }))
    fireEvent.click(within(risk).getByRole('button', { name: '确认下载并安装' }))
    await waitFor(() => {
      expect(mocks.install).toHaveBeenCalledWith({ slug: 'community-plugin' })
    })
    expect((await screen.findByRole('dialog', { name: '插件已安装' })).textContent).toContain('重启当前 Profile')
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: '社区插件: 已安装', hidden: true })).toBeTruthy()
    })
  })

  it('surfaces stable install errors and retries through the same confirmation path', async () => {
    mocks.install.mockResolvedValueOnce({
      status: 'failed',
      code: 'install-failed',
      retryable: true,
    })
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '下载 测试插件' }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '确认下载并安装' }))
    const failure = await screen.findByRole('dialog', { name: '安装失败' })
    expect(failure.textContent).toContain(zh.installFailed)
    expect(screen.getByRole('button', { name: '重试下载 测试插件', hidden: true })).toBeTruthy()
    fireEvent.click(within(failure).getByRole('button', { name: '重试' }))
    expect(screen.getByRole('dialog', { name: '安装插件' })).toBeTruthy()
    expect(mocks.install).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '确认下载并安装' }))
    await waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(2))
  })

  it('handles list failure, retry, empty categories and cursor pagination', async () => {
    mocks.list.mockRejectedValueOnce(new Error('transport'))
    const failed = renderTab()
    expect((await screen.findByRole('alert')).textContent).toContain(zh.unavailable)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('测试插件')).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(2)
    failed.unmount()

    mocks.list.mockResolvedValue(page({ items: [], nextCursor: null }))
    const empty = renderTab()
    expect(await screen.findByText(zh.empty)).toBeTruthy()
    empty.unmount()

    installObserver()
    mocks.list.mockResolvedValueOnce(page({ nextCursor: 'cursor-two' }))
    mocks.list.mockResolvedValueOnce(page({ items: [plugin({ slug: 'third', name: '第三个插件' })] }))
    renderTab()
    expect(await screen.findByText('测试插件')).toBeTruthy()
    await intersectLatestObserver()
    await waitFor(() => {
      expect(mocks.list).toHaveBeenLastCalledWith({ locale: 'zh', cursor: 'cursor-two' }, signalOptions)
      expect(screen.getByText('第三个插件')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
  })
})
