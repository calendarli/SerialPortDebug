import * as ts from 'typescript'

export function transpileProgram(source: string): string {
  const file = ts.createSourceFile('program.ts', source, ts.ScriptTarget.ES2022, true)
  // Scripts execute in an isolated VM, without a module loader or external dependencies.
  const checkModules = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      node.kind === ts.SyntaxKind.ExportKeyword ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      throw new Error('编程模式不支持 import / export，请在当前脚本内定义函数和类型')
    ts.forEachChild(node, checkModules)
  }
  checkModules(file)
  const result = ts.transpileModule(source, {
    fileName: 'program.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
      sourceMap: false
    }
  })
  const errors =
    result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) || []
  if (errors.length) {
    throw new Error(
      errors
        .map((item) => {
          const position =
            item.file && item.start !== undefined
              ? item.file.getLineAndCharacterOfPosition(item.start)
              : null
          return `${position ? `第 ${position.line + 1} 行，第 ${position.character + 1} 列：` : ''}${ts.flattenDiagnosticMessageText(item.messageText, '\n')}`
        })
        .join('\n')
    )
  }
  return result.outputText
}
