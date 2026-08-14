import { useEffect, useRef, useState, type ReactNode } from 'react'

type Tab = 'serial' | 'commands' | 'rules' | 'scripts'
type Props = {
  activeTab: Tab
  commandCount: number
  enabledRuleCount: number
  enabledScriptCount: number
  onTabChange: (tab: Tab) => void
  serialContent: ReactNode
  commandsContent: ReactNode
  rulesContent: ReactNode
  scriptsContent: ReactNode
}
const storageKey = 'serialflow.sidebarWidth'
const defaultWidth = 320
const minWidth = 270

function clampWidth(value: number): number {
  const maxWidth = Math.min(560, Math.floor(window.innerWidth * 0.48))
  return Math.min(Math.max(value, minWidth), Math.max(minWidth, maxWidth))
}

function initialWidth(): number {
  const saved = Number(localStorage.getItem(storageKey))
  return clampWidth(Number.isFinite(saved) && saved > 0 ? saved : defaultWidth)
}

export function Sidebar(props: Props): React.JSX.Element {
  const [width, setWidth] = useState(initialWidth)
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
    dragStart.current = { x: event.clientX, width }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const nextWidth = clampWidth(dragStart.current.width + event.clientX - dragStart.current.x)
    widthRef.current = nextWidth
    setWidth(nextWidth)
  }
  const finishResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(storageKey, String(widthRef.current))
    setResizing(false)
  }
  const resetWidth = (): void => {
    setWidth(defaultWidth)
    widthRef.current = defaultWidth
    localStorage.setItem(storageKey, String(defaultWidth))
  }

  return (
    <aside
      className={`config-panel resizable-sidebar ${resizing ? 'resizing' : ''}`}
      style={{ width }}
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
          title="脚本"
          className={props.activeTab === 'scripts' ? 'active' : ''}
          onClick={() => props.onTabChange('scripts')}
        >
          <span className="tab-icon">{'{ }'}</span>
          <span>脚本</span>
          {props.enabledScriptCount > 0 && <b>{props.enabledScriptCount}</b>}
        </button>
      </nav>
      <div className="side-page">
        {props.activeTab === 'serial'
          ? props.serialContent
          : props.activeTab === 'commands'
            ? props.commandsContent
            : props.activeTab === 'rules'
              ? props.rulesContent
              : props.scriptsContent}
      </div>
      <div
        className="sidebar-resizer"
        title="拖拽调整宽度，双击恢复默认"
        onPointerDown={beginResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onDoubleClick={resetWidth}
      />
    </aside>
  )
}
