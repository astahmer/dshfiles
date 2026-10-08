// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCard, MarketplaceListOutput } from '../src/api.js'
import { zh } from '../src/locales.js'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  install: vi.fn(),
}))

vi.mock('@dshfiles/dshx/client', () => ({
  defineLocale: (namespace: string, dictionaries: unknown) => ({ namespace, dictionaries }),
  useApi: () => ({ list: mocks.list, install: mocks.install }),
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
    ...overrides,
  }
}

function t(key: string, params?: Record<string, unknown>): string {
  return (zh[key as keyof typeof zh] ?? key).replace(/\{([^}]+)\}/g, (_match, name: string) => String(params?.[name] ?? `{${name}}`))
}

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
  vi.clearAllMocks()
})

describe('MarketplaceTab', () => {
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
    expect(screen.queryByRole('link')).toBeNull()
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

    mocks.list.mockResolvedValueOnce(page({ nextCursor: 'cursor-two' }))
    mocks.list.mockResolvedValueOnce(page({ items: [plugin({ slug: 'third', name: '第三个插件' })] }))
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await waitFor(() => {
      expect(mocks.list).toHaveBeenLastCalledWith({ locale: 'zh', cursor: 'cursor-two' }, signalOptions)
      expect(screen.getByText('第三个插件')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull()
  })
})
