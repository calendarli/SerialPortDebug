import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ActiveTooltip = { anchor: HTMLElement; text: string }
type TooltipPosition = { left: number; top: number; placement: 'top' | 'bottom'; visible: boolean }

function findTooltipTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null
}

export function GlobalTooltip(): React.JSX.Element | null {
  const [active, setActive] = useState<ActiveTooltip | null>(null)
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    placement: 'bottom',
    visible: false
  })
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const show = (anchor: HTMLElement): void => {
      const text = anchor.dataset.tooltip?.trim()
      if (text) setActive({ anchor, text })
    }
    const handlePointerOver = (event: PointerEvent): void => {
      const anchor = findTooltipTarget(event.target)
      if (anchor) show(anchor)
    }
    const handlePointerOut = (event: PointerEvent): void => {
      const anchor = findTooltipTarget(event.target)
      if (!anchor) return
      const related = event.relatedTarget
      if (related instanceof Node && anchor.contains(related)) return
      setActive((current) => (current?.anchor === anchor ? null : current))
    }
    const handleFocusIn = (event: FocusEvent): void => {
      const anchor = findTooltipTarget(event.target)
      if (anchor) show(anchor)
    }
    const handleFocusOut = (event: FocusEvent): void => {
      const anchor = findTooltipTarget(event.target)
      if (anchor) setActive((current) => (current?.anchor === anchor ? null : current))
    }
    document.addEventListener('pointerover', handlePointerOver)
    document.addEventListener('pointerout', handlePointerOut)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('pointerover', handlePointerOver)
      document.removeEventListener('pointerout', handlePointerOut)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) {
      setPosition((current) => ({ ...current, visible: false }))
      return
    }
    const updatePosition = (): void => {
      if (!active.anchor.isConnected || !tooltipRef.current) return setActive(null)
      const anchorRect = active.anchor.getBoundingClientRect()
      const tooltipRect = tooltipRef.current.getBoundingClientRect()
      const gap = 9
      const edge = 8
      let placement: 'top' | 'bottom' = 'bottom'
      let top = anchorRect.bottom + gap
      if (top + tooltipRect.height > window.innerHeight - edge) {
        placement = 'top'
        top = anchorRect.top - tooltipRect.height - gap
      }
      top = Math.max(edge, Math.min(top, window.innerHeight - tooltipRect.height - edge))
      const centered = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
      const left = Math.max(edge, Math.min(centered, window.innerWidth - tooltipRect.width - edge))
      setPosition({ left, top, placement, visible: true })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [active])

  if (!active) return null
  return createPortal(
    <div
      ref={tooltipRef}
      className={`global-tooltip ${position.placement}`}
      role="tooltip"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden'
      }}
    >
      {active.text}
    </div>,
    document.body
  )
}
