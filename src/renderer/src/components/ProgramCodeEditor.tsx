import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes
} from 'react'
import type { highlightProgram } from '../scripts/program-highlight'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string }

export function ProgramCodeEditor({ value, onScroll, ...props }: Props): React.JSX.Element {
  const [highlight, setHighlight] = useState<typeof highlightProgram | null>(null)
  const backdrop = useRef<HTMLPreElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const syncGeometry = (): void => {
    if (!backdrop.current || !viewport.current || !input.current) return
    // The textarea owns scrolling. A second scroll container clamps differently when
    // native scrollbars consume space, shifting the highlighted text near either end.
    viewport.current.style.width = `${input.current.clientWidth}px`
    viewport.current.style.height = `${input.current.clientHeight}px`
    backdrop.current.style.transform = `translate(${-input.current.scrollLeft}px, ${-input.current.scrollTop}px)`
  }
  useEffect(() => {
    let active = true
    void import('../scripts/program-highlight')
      .then(({ highlightProgram }) => {
        if (active) setHighlight(() => highlightProgram)
      })
      .catch(() => {
        /* Keep the editable plain-text fallback if loading fails. */
      })
    return () => {
      active = false
    }
  }, [])
  const tokens = useMemo(
    () => (highlight ? highlight(value) : [{ text: value, tone: '' }]),
    [highlight, value]
  )
  useLayoutEffect(syncGeometry, [tokens])
  useLayoutEffect(() => {
    if (!input.current) return
    const observer = new ResizeObserver(syncGeometry)
    observer.observe(input.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="program-code-editor">
      <div ref={viewport} className="program-code-viewport" aria-hidden="true">
        <pre ref={backdrop}>
          {tokens.map((token, index) => (
            <span key={index} className={token.tone ? `syntax-${token.tone}` : undefined}>
              {token.text}
            </span>
          ))}
          {'\n'}
        </pre>
      </div>
      <textarea
        {...props}
        ref={input}
        value={value}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onScroll={(event) => {
          syncGeometry()
          onScroll?.(event)
        }}
      />
    </div>
  )
}
