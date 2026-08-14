import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as monaco from 'monaco-editor'
import './monaco-setup'
import scriptApiTypes from './script-api.d.ts?raw'
import { hashScriptSource } from './script-pipeline'
import type { ScriptLanguage } from './script-types'

export type ScriptCompileResult = { code: string; sourceHash: string }
export type ScriptEditorHandle = {
  compile(): Promise<ScriptCompileResult>
  format(): Promise<void>
  focus(): void
}

type Props = {
  scriptId: string
  language: ScriptLanguage
  value: string
  onChange(value: string): void
  onSave(): void
  onTest(): void
}

let configured = false
const models = new Map<string, monaco.editor.ITextModel>()
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()
const editorFontSizeKey = 'serialflow.scriptEditorFontSize'
const defaultEditorFontSize = 17
const minEditorFontSize = 12
const maxEditorFontSize = 32

function loadEditorFontSize(): number {
  const saved = Number(localStorage.getItem(editorFontSizeKey))
  if (!Number.isFinite(saved)) return defaultEditorFontSize
  return Math.min(maxEditorFontSize, Math.max(minEditorFontSize, Math.round(saved)))
}

function editorLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.5)
}

function configureTypeScript(): void {
  if (configured) return
  configured = true
  const options: monaco.typescript.CompilerOptions = {
    target: monaco.typescript.ScriptTarget.ES2020,
    module: monaco.typescript.ModuleKind.None,
    strict: true,
    noEmitOnError: false,
    sourceMap: true,
    allowNonTsExtensions: true,
    lib: ['es2020', 'dom']
  }
  monaco.typescript.typescriptDefaults.setCompilerOptions(options)
  monaco.typescript.javascriptDefaults.setCompilerOptions({ ...options, checkJs: true })
  monaco.typescript.typescriptDefaults.addExtraLib(
    scriptApiTypes,
    'serialflow://types/script-api.d.ts'
  )
  monaco.typescript.javascriptDefaults.addExtraLib(
    scriptApiTypes,
    'serialflow://types/script-api.d.ts'
  )
}

function diagnosticText(
  model: monaco.editor.ITextModel,
  diagnostics: monaco.typescript.Diagnostic[]
): string | null {
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === 1)
  if (!errors.length) return null
  return errors
    .slice(0, 8)
    .map((diagnostic) => {
      const message =
        typeof diagnostic.messageText === 'string'
          ? diagnostic.messageText
          : diagnostic.messageText.messageText
      const position = model.getPositionAt(diagnostic.start || 0)
      return `第 ${position.lineNumber} 行，第 ${position.column} 列：${message}`
    })
    .join('\n')
}

export const ScriptEditor = forwardRef<ScriptEditorHandle, Props>(
  function ScriptEditor(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const propsRef = useRef(props)
    propsRef.current = props

    useEffect(() => {
      configureTypeScript()
      if (!containerRef.current) return
      const uri = monaco.Uri.parse(
        `serialflow://scripts/${props.scriptId}.${props.language === 'typescript' ? 'ts' : 'js'}`
      )
      let model = models.get(props.scriptId)
      if (!model || model.uri.toString() !== uri.toString()) {
        model?.dispose()
        model = monaco.editor.createModel(
          propsRef.current.value,
          props.language === 'typescript' ? 'typescript' : 'javascript',
          uri
        )
        models.set(props.scriptId, model)
      }
      const editorContainer = containerRef.current
      let editorFontSize = loadEditorFontSize()
      const editor = monaco.editor.create(editorContainer, {
        model,
        theme: 'vs',
        automaticLayout: true,
        minimap: { enabled: true, scale: 0.75 },
        fontFamily: 'Consolas, "SFMono-Regular", monospace',
        fontSize: editorFontSize,
        lineHeight: editorLineHeight(editorFontSize),
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding: { top: 10, bottom: 10 }
      })
      editorRef.current = editor
      const savedViewState = viewStates.get(props.scriptId)
      if (savedViewState) editor.restoreViewState(savedViewState)
      const change = model.onDidChangeContent(() => propsRef.current.onChange(model!.getValue()))
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        propsRef.current.onSave()
      )
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
        propsRef.current.onTest()
      )
      const handleFontZoom = (event: WheelEvent): void => {
        if (!event.ctrlKey || event.deltaY === 0) return
        event.preventDefault()
        event.stopPropagation()
        const next = Math.min(
          maxEditorFontSize,
          Math.max(minEditorFontSize, editorFontSize + (event.deltaY < 0 ? 1 : -1))
        )
        if (next === editorFontSize) return
        editorFontSize = next
        editor.updateOptions({
          fontSize: next,
          lineHeight: editorLineHeight(next)
        })
        localStorage.setItem(editorFontSizeKey, String(next))
      }
      editorContainer.addEventListener('wheel', handleFontZoom, {
        capture: true,
        passive: false
      })
      return () => {
        viewStates.set(props.scriptId, editor.saveViewState())
        editorContainer.removeEventListener('wheel', handleFontZoom, true)
        change.dispose()
        editor.dispose()
        editorRef.current = null
      }
    }, [props.language, props.scriptId])

    useEffect(() => {
      const model = editorRef.current?.getModel()
      if (model && model.getValue() !== props.value) model.setValue(props.value)
    }, [props.value])

    useImperativeHandle(
      ref,
      () => ({
        async compile() {
          const model = editorRef.current?.getModel()
          if (!model) throw new Error('脚本编辑器尚未加载')
          const languageApi =
            props.language === 'typescript'
              ? monaco.typescript.getTypeScriptWorker
              : monaco.typescript.getJavaScriptWorker
          const workerFactory = await languageApi()
          const worker = await workerFactory(model.uri)
          const fileName = model.uri.toString()
          const [syntactic, semantic] = await Promise.all([
            worker.getSyntacticDiagnostics(fileName),
            worker.getSemanticDiagnostics(fileName)
          ])
          const error = diagnosticText(model, [...syntactic, ...semantic])
          if (error) throw new Error(error)
          if (props.language === 'javascript')
            return { code: model.getValue(), sourceHash: hashScriptSource(model.getValue()) }
          const output = await worker.getEmitOutput(fileName)
          const javascript = output.outputFiles.find((file) => file.name.endsWith('.js'))
          if (!javascript?.text) throw new Error('TypeScript 编译没有生成 JavaScript')
          return { code: javascript.text, sourceHash: hashScriptSource(model.getValue()) }
        },
        async format() {
          await editorRef.current?.getAction('editor.action.formatDocument')?.run()
        },
        focus() {
          editorRef.current?.focus()
        }
      }),
      [props.language]
    )

    return <div className="script-monaco" ref={containerRef} />
  }
)
