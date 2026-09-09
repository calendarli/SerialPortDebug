import * as ts from 'typescript'

export type CodeToken = { text: string; tone: string }

// Parse without executing: AST tokens distinguish regex literals and template expressions.
export function highlightProgram(source: string): CodeToken[] {
  const file = ts.createSourceFile('program.ts', source, ts.ScriptTarget.Latest, true)
  const tokens: CodeToken[] = []
  let offset = 0
  const append = (end: number, tone: string): void => {
    if (end <= offset) return
    tokens.push({ text: source.slice(offset, end), tone })
    offset = end
  }
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(file)
    if (children.length) {
      children.forEach(visit)
      return
    }
    const start = node.getStart(file)
    append(start, 'comment') // Gaps between syntax tokens contain only whitespace/comments.
    const kind = node.kind
    let tone = ''
    if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) tone = 'keyword'
    else if (kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral)
      tone = 'number'
    else if (
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.RegularExpressionLiteral ||
      (kind >= ts.SyntaxKind.FirstTemplateToken && kind <= ts.SyntaxKind.LastTemplateToken)
    )
      tone = 'string'
    else if (kind === ts.SyntaxKind.Identifier) {
      tone = /^\s*\(/.test(source.slice(node.end)) ? 'function' : 'identifier'
    }
    append(node.end, tone)
  }
  visit(file)
  append(source.length, 'comment')
  return tokens
}
