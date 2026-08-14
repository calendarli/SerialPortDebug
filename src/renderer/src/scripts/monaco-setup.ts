import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'

type MonacoWorkerEnvironment = {
  getWorker(_moduleId: string, label: string): Worker
}

const scope = self as unknown as { MonacoEnvironment?: MonacoWorkerEnvironment }

if (!scope.MonacoEnvironment) {
  scope.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new JsonWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }
}
