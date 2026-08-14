import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  className?: string
  children: ReactNode
}

type Position = { left: number; top: number; visible: boolean }

export function FloatingPanel(props: Props): React.JSX.Element | null {
  const { anchorRef, open, onClose } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<Position>({ left: 0, top: 0, visible: false })

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchorRef, onClose, open])

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !panelRef.current) return
    const updatePosition = (): void => {
      const anchor = anchorRef.current
      if (!anchor?.isConnected || !panelRef.current) return onClose()
      const anchorRect = anchor.getBoundingClientRect()
      const panelRect = panelRef.current.getBoundingClientRect()
      const edge = 8
      const gap = 8
      let top = anchorRect.bottom + gap
      if (top + panelRect.height > window.innerHeight - edge)
        top = anchorRect.top - panelRect.height - gap
      top = Math.max(edge, Math.min(top, window.innerHeight - panelRect.height - edge))
      const preferredLeft = anchorRect.right - panelRect.width
      const left = Math.max(
        edge,
        Math.min(preferredLeft, window.innerWidth - panelRect.width - edge)
      )
      setPosition({ left, top, visible: true })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null
  return createPortal(
    <div
      ref={panelRef}
      className={`global-floating-panel ${props.className || ''}`}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden'
      }}
    >
      {props.children}
    </div>,
    document.body
  )
}
