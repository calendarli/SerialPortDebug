import { useEffect, useRef, useState, type ReactNode } from 'react'

type Tab = 'serial' | 'pairs' | 'commands' | 'rules' | 'modbus' | 'about'
type Props = {
  activeTab: Tab
  commandCount: number
  enabledRuleCount: number
  onTabChange: (tab: Tab) => void
  serialContent: ReactNode
  commandsContent: ReactNode
  rulesContent: ReactNode
  aboutContent: ReactNode
}
const storageKey = 'serialflow.sidebarWidth'
const collapsedStorageKey = 'serialflow.sidebarCollapsed'
const tabRailWidth = 52
const tabPageWidth = 260
const defaultWidth = tabRailWidth + tabPageWidth

function clampWidth(value: number): number {
  return Math.max(value, tabRailWidth)
}

function initialWidth(): number {
  const saved = Number(localStorage.getItem(storageKey))
  return clampWidth(Number.isFinite(saved) && saved > 0 ? saved : defaultWidth)
}

export function Sidebar(props: Props): React.JSX.Element {
  const fullPage = ['modbus', 'pairs'].includes(props.activeTab)
  const [width, setWidth] = useState(initialWidth)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(collapsedStorageKey) === 'true'
  )
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef({ x: 0, width: defaultWidth })
  const widthRef = useRef(width)

  useEffect(() => {
    const handleResize = (): void =>
      setWidth((current) => {
        const nextWidth = clampWidth(current)
        widthRef.current = nextWidth
        return nextWidth
      })
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startWidth = collapsed ? tabRailWidth : width
    dragStart.current = { x: event.clientX, width: startWidth }
    if (collapsed) {
      setWidth(tabRailWidth)
      widthRef.current = tabRailWidth
      setCollapsed(false)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const nextWidth = clampWidth(dragStart.current.width + event.clientX - dragStart.current.x)
    widthRef.current = nextWidth
    setWidth(nextWidth)
    setCollapsed(nextWidth <= tabRailWidth)
  }
  const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(storageKey, String(widthRef.current))
    localStorage.setItem(collapsedStorageKey, String(widthRef.current <= tabRailWidth))
    setResizing(false)
  }
  const resetWidth = (): void => {
    setWidth(defaultWidth)
    widthRef.current = defaultWidth
    localStorage.setItem(storageKey, String(defaultWidth))
  }
  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      const next = !current
      const nextWidth = next ? tabRailWidth : defaultWidth
      setWidth(nextWidth)
      widthRef.current = nextWidth
      localStorage.setItem(storageKey, String(nextWidth))
      localStorage.setItem(collapsedStorageKey, String(next))
      return next
    })
  }

  return (
    <aside
      className={`config-panel resizable-sidebar ${fullPage ? 'full-page-tab-only' : ''} ${collapsed ? 'collapsed' : ''} ${resizing ? 'resizing' : ''}`}
      style={{ width: fullPage || collapsed ? tabRailWidth : width }}
    >
      <nav className="side-tabs" aria-label="侧栏导航">
        <button
          title="串口"
          className={props.activeTab === 'serial' ? 'active' : ''}
          onClick={() => props.onTabChange('serial')}
        >
          <span className="tab-icon">⌁</span>
          <span>串口</span>
        </button>
        <button
          title="虚拟串口对"
          className={props.activeTab === 'pairs' ? 'active' : ''}
          onClick={() => props.onTabChange('pairs')}
        >
          <span className="tab-icon">↔</span>
          <span>串口对</span>
        </button>
        <button
          title="快捷指令"
          className={props.activeTab === 'commands' ? 'active' : ''}
          onClick={() => props.onTabChange('commands')}
        >
          <span className="tab-icon">›_</span>
          <span>指令</span>
          {props.commandCount > 0 && <b>{props.commandCount}</b>}
        </button>
        <button
          title="自动回复"
          className={props.activeTab === 'rules' ? 'active' : ''}
          onClick={() => props.onTabChange('rules')}
        >
          <span className="tab-icon">⌘</span>
          <span>回复</span>
          {props.enabledRuleCount > 0 && <b>{props.enabledRuleCount}</b>}
        </button>
        <button
          title="Modbus RTU"
          className={props.activeTab === 'modbus' ? 'active' : ''}
          onClick={() => props.onTabChange('modbus')}
        >
          <span className="tab-icon">M</span>
          <span>Modbus</span>
        </button>
        <button
          title="帮助"
          className="help-tab"
          onClick={() =>
            window.open(
              new URL('help.html', window.location.href).toString(),
              'serialflow-help'
            )
          }
        >
          <span className="tab-icon">?</span>
          <span>帮助</span>
        </button>
        {!fullPage && (
          <button
            className="sidebar-collapse-tab"
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            onClick={toggleCollapsed}
          >
            <span className="tab-icon">{collapsed ? '»' : '«'}</span>
            <span>{collapsed ? '展开' : '收起'}</span>
          </button>
        )}
        <button
          title="关于"
          className={`about-tab ${props.activeTab === 'about' ? 'active' : ''}`}
          onClick={() => props.onTabChange('about')}
        >
          <span className="tab-icon">ⓘ</span>
          <span>关于</span>
        </button>
      </nav>
      {!fullPage && (
        <>
          {!collapsed && (
            <div className="side-page">
              {props.activeTab === 'serial'
                ? props.serialContent
                : props.activeTab === 'commands'
                  ? props.commandsContent
                  : props.activeTab === 'rules'
                    ? props.rulesContent
                    : props.aboutContent}
            </div>
          )}
          <div
            className="sidebar-resizer"
            title="拖拽调整宽度，双击恢复默认"
            onPointerDown={beginResize}
            onPointerMove={resize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onDoubleClick={resetWidth}
          />
        </>
      )}
    </aside>
  )
}
