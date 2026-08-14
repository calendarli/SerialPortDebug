import { memo, useCallback, useEffect, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { InteractionEntry } from '../types'

type SearchDirection = 'up' | 'down' | null
type ContextMenu = { x: number; y: number; entry: InteractionEntry | null }

type Props = {
  entries: InteractionEntry[]
  rxHex: boolean
  rxCommunicationCount: number
  txCommunicationCount: number
  rxFrequency: number
  txFrequency: number
  timestamp: boolean
  paused: boolean
  autoPauseEnabled: boolean
  autoPausePattern: string
  autoPauseRegex: boolean
  autoPauseHex: boolean
  cacheSizeMb: number
  cacheEntryLimit: number
  fontSize: number
  cacheBytes: number
  onClear: () => void
  onRxHexChange: (value: boolean) => void
  onTimestampChange: (value: boolean) => void
  onPausedChange: (value: boolean) => void
  onAutoPauseEnabledChange: (value: boolean) => void
  onAutoPausePatternChange: (value: string) => void
  onAutoPauseRegexChange: (value: boolean) => void
  onAutoPauseHexChange: (value: boolean) => void
  onCacheSizeChange: (value: number) => void
  onCacheEntryLimitChange: (value: number) => void
  onFontSizeChange: (value: number) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const InteractionRow = memo(function InteractionRow({
  entry,
  matched,
  onContextMenu
}: {
  entry: InteractionEntry
  matched: boolean
  onContextMenu: (event: React.MouseEvent, entry: InteractionEntry) => void
}): React.JSX.Element {
  return (
    <div
      data-interaction-id={entry.id}
      className={`interaction-entry ${entry.direction} ${matched ? 'search-match' : ''}`}
      onContextMenu={(event) => onContextMenu(event, entry)}
    >
      <div className="interaction-meta">
        <b>{entry.direction.toUpperCase()}</b>
        <em>{entry.port}</em>
        {entry.time && <time>{entry.time}</time>}
        <span>{entry.bytes} B</span>
      </div>
      <pre>{entry.text || ' '}</pre>
    </div>
  )
})

export function ReceivePanel(props: Props): React.JSX.Element {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [direction, setDirection] = useState<SearchDirection>(null)
  const [matchedEntryId, setMatchedEntryId] = useState<number | null>(null)
  const [searchMessage, setSearchMessage] = useState('')
  const virtualizer = useVirtualizer({
    count: props.entries.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => props.entries[index].id,
    estimateSize: () => Math.max(24, Math.ceil(props.fontSize * 2.25)),
    overscan: 14
  })
  const lastEntryId = props.entries[props.entries.length - 1]?.id

  useEffect(() => {
    virtualizer.measure()
    if (props.entries.length) virtualizer.scrollToIndex(props.entries.length - 1, { align: 'end' })
  }, [lastEntryId, props.entries.length, props.fontSize, virtualizer])

  useEffect(() => {
    const closeMenu = (): void => setMenu(null)
    const openWithShortcut = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        window.setTimeout(() => document.getElementById('interaction-search-input')?.focus(), 0)
      }
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('keydown', openWithShortcut)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('keydown', openWithShortcut)
    }
  }, [])

  const openContextMenu = useCallback(
    (event: React.MouseEvent, entry: InteractionEntry | null): void => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 180),
        y: Math.min(event.clientY, window.innerHeight - 90),
        entry
      })
    },
    []
  )
  const copyEntry = async (entry: InteractionEntry): Promise<void> => {
    try {
      await navigator.clipboard.writeText(entry.text)
      setMenu(null)
    } catch {
      setSearchMessage('复制失败，请检查剪贴板权限')
      setMenu(null)
    }
  }
  const clearEntries = (): void => {
    props.onClear()
    setMatchedEntryId(null)
    setSearchMessage('')
    setMenu(null)
  }
  const closeSearch = (): void => {
    setSearchOpen(false)
    setMatchedEntryId(null)
    setSearchMessage('')
  }
  const findNext = (): void => {
    if (!query) return setSearchMessage('请输入搜索内容')
    let matcher: RegExp
    try {
      matcher = new RegExp(regex ? query : escapeRegExp(query), 'i')
    } catch (error) {
      return setSearchMessage(
        error instanceof Error ? `正则错误：${error.message}` : '正则表达式错误'
      )
    }
    const matches = props.entries
      .map((entry, index) => (matcher.test(entry.text) ? index : -1))
      .filter((index) => index >= 0)
    if (!matches.length) {
      setMatchedEntryId(null)
      return setSearchMessage('未找到匹配内容')
    }
    const currentIndex =
      matchedEntryId === null ? -1 : props.entries.findIndex((entry) => entry.id === matchedEntryId)
    let next: number | undefined
    if (direction === 'up')
      next = [...matches]
        .reverse()
        .find((index) => index < (currentIndex < 0 ? props.entries.length : currentIndex))
    else if (direction === 'down') next = matches.find((index) => index > currentIndex)
    else next = matches.find((index) => index > currentIndex) ?? matches[0]
    if (next === undefined)
      return setSearchMessage(direction === 'up' ? '已到达顶部' : '已到达底部')
    const entry = props.entries[next]
    setMatchedEntryId(entry.id)
    setSearchMessage(`${matches.indexOf(next) + 1} / ${matches.length}`)
    virtualizer.scrollToIndex(next, { align: 'center' })
  }
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey) return
    event.preventDefault()
    props.onFontSizeChange(props.fontSize + (event.deltaY < 0 ? 1 : -1))
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && searchOpen) closeSearch()
  }
  const formatCacheBytes = (bytes: number): string =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
      : bytes >= 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${bytes} B`
  const formatFrequency = (frequency: number): string =>
    frequency < 10 && frequency > 0 ? frequency.toFixed(1) : Math.round(frequency).toLocaleString()
  let autoPausePatternValid = true
  if (props.autoPauseRegex && props.autoPausePattern) {
    try {
      new RegExp(props.autoPausePattern)
    } catch {
      autoPausePatternValid = false
    }
  } else if (props.autoPauseHex && props.autoPausePattern) {
    autoPausePatternValid = /^(?:[0-9a-f]{2}\s*)+$/i.test(props.autoPausePattern)
  }

  return (
    <div className="receiver card">
      <div className="card-head interaction-head">
        <div>
          <strong>数据交互</strong>
          <span>
            通讯 RX {props.rxCommunicationCount.toLocaleString()} 次 / TX{' '}
            {props.txCommunicationCount.toLocaleString()} 次 · 缓存{' '}
            {formatCacheBytes(props.cacheBytes)} / {props.cacheSizeMb} MB · 频率 RX{' '}
            {formatFrequency(props.rxFrequency)} Hz / TX {formatFrequency(props.txFrequency)} Hz
          </span>
        </div>
        <div className="head-tools">
          <span className="font-size-indicator" title="在数据视窗中按 Ctrl + 鼠标滚轮调整">
            字号 {props.fontSize}px
          </span>
          <div className="cache-controls">
            <label title="交互记录最大容量">
              缓存{' '}
              <input
                type="number"
                min="1"
                max="1024"
                defaultValue={props.cacheSizeMb}
                onBlur={(event) => {
                  const value = Math.min(1024, Math.max(1, Number(event.target.value) || 8))
                  event.currentTarget.value = String(value)
                  props.onCacheSizeChange(value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />{' '}
              MB
            </label>
            <label title="交互记录最大条数，0 表示不限制">
              条数{' '}
              <input
                type="number"
                min="0"
                max="1000000"
                step="100"
                defaultValue={props.cacheEntryLimit}
                onBlur={(event) => {
                  const raw = event.target.value.trim()
                  const value =
                    raw === '' ? 5000 : Math.min(1_000_000, Math.max(0, Number(raw) || 0))
                  event.currentTarget.value = String(value)
                  props.onCacheEntryLimitChange(value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
          </div>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.rxHex}
              onChange={(event) => props.onRxHexChange(event.target.checked)}
            />
            接收 HEX
          </label>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.timestamp}
              onChange={(event) => props.onTimestampChange(event.target.checked)}
            />
            时间戳
          </label>
          <label className="head-check">
            <input
              type="checkbox"
              checked={props.paused}
              onChange={(event) => props.onPausedChange(event.target.checked)}
            />
            暂停接收显示
          </label>
          <button className="head-tool-button subtle" onClick={clearEntries}>
            清空
          </button>
        </div>
      </div>
      <div className="auto-pause-bar">
        <label className="head-check">
          <input
            type="checkbox"
            checked={props.autoPauseEnabled}
            onChange={(event) => props.onAutoPauseEnabledChange(event.target.checked)}
          />
          条件暂停
        </label>
        <div className="mini-segment">
          <button
            className={!props.autoPauseHex ? 'active' : ''}
            onClick={() => props.onAutoPauseHexChange(false)}
          >
            ASCII
          </button>
          <button
            className={props.autoPauseHex ? 'active' : ''}
            onClick={() => props.onAutoPauseHexChange(true)}
          >
            HEX
          </button>
        </div>
        <input
          className={autoPausePatternValid ? '' : 'invalid'}
          disabled={!props.autoPauseEnabled}
          value={props.autoPausePattern}
          placeholder={props.autoPauseHex ? '例如：AA 01 BB' : '例如：STOP'}
          onChange={(event) => props.onAutoPausePatternChange(event.target.value)}
          title={autoPausePatternValid ? '匹配后自动暂停后续接收显示' : '条件格式无效'}
        />
        <label className="head-check">
          <input
            type="checkbox"
            disabled={!props.autoPauseEnabled}
            checked={props.autoPauseRegex}
            onChange={(event) => props.onAutoPauseRegexChange(event.target.checked)}
          />
          正则
          <span
            className="regex-help"
            tabIndex={0}
            aria-label="条件暂停正则使用说明"
            data-tooltip={
              props.autoPauseHex
                ? '匹配标准化 HEX 字节文本，字节间用空格分隔。\n示例：^AA [0-9A-F]{2} BB$\n匹配后显示当前数据，并暂停后续 RX 显示。'
                : '匹配接收到的 ASCII 文本，并兼容 CR/LF 行尾。\n示例：^STOP$ 或 ^TEMP=[0-9]+$\n匹配后暂停后续 RX 显示。'
            }
          >
            ?
          </span>
        </label>
        {!autoPausePatternValid && <span className="auto-pause-error">条件格式无效</span>}
      </div>
      {searchOpen && (
        <div
          className="interaction-search"
          onKeyDown={(event) => {
            if (event.key === 'Enter') findNext()
            else if (event.key === 'Escape') closeSearch()
          }}
        >
          <input
            id="interaction-search-input"
            value={query}
            placeholder={regex ? '输入正则表达式' : '搜索交互内容'}
            onChange={(event) => {
              setQuery(event.target.value)
              setMatchedEntryId(null)
              setSearchMessage('')
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={regex}
              onChange={(event) => {
                setRegex(event.target.checked)
                setMatchedEntryId(null)
                setSearchMessage('')
              }}
            />
            正则
            <span
              className="regex-help"
              tabIndex={0}
              aria-label="搜索正则使用说明"
              data-tooltip={
                '在全部缓存的交互内容中进行正则搜索。\n. 匹配任意字符；[0-9]+ 匹配连续数字；| 表示或。\n示例：AA .* BB 或 ERROR|WARN'
              }
            >
              ?
            </span>
          </label>
          <button
            title="向上搜索；再次点击取消方向"
            className={direction === 'up' ? 'active' : ''}
            onClick={() => setDirection(direction === 'up' ? null : 'up')}
          >
            ↑
          </button>
          <button
            title="向下搜索；再次点击取消方向"
            className={direction === 'down' ? 'active' : ''}
            onClick={() => setDirection(direction === 'down' ? null : 'down')}
          >
            ↓
          </button>
          <button className="find-button" onClick={findNext}>
            查找
          </button>
          <span>{searchMessage}</span>
          <button className="close-search" onClick={closeSearch}>
            ×
          </button>
        </div>
      )}
      <div
        className="terminal interaction-view"
        ref={setScrollElement}
        tabIndex={0}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => openContextMenu(event, null)}
        style={{ '--interaction-font-size': `${props.fontSize}px` } as React.CSSProperties}
      >
        {props.entries.length ? (
          <div className="interaction-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = props.entries[item.index]
              return (
                <div
                  className="interaction-virtual-row"
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <InteractionRow
                    entry={entry}
                    matched={matchedEntryId === entry.id}
                    onContextMenu={openContextMenu}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <span className="placeholder">等待串口数据交互…</span>
        )}
      </div>
      {menu && (
        <div
          className="context-menu interaction-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.entry && (
            <button onClick={() => void copyEntry(menu.entry!)}>
              复制当前
              {menu.entry.direction === 'tx'
                ? '发送指令/数据'
                : menu.entry.direction === 'script'
                  ? '脚本结果'
                  : '接收数据'}
            </button>
          )}
          {menu.entry && <div className="menu-separator" />}
          <button className="danger" onClick={clearEntries}>
            清空列表
          </button>
        </div>
      )}
    </div>
  )
}
