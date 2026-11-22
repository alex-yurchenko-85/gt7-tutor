import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../src');
const LETTER = /\p{L}/u;
const TEXT_PROP = /^(aria-label|title|placeholder|alt)$|(label|Label|title|Title|hint|Hint|text|Text|caption|Caption|legend|Legend|Name|action)$/;
const NOT_TEXT_PROP = new Set(['className', 'name', 'labelledBy', 'aria-labelledby']);

const ALLOWED: { text: string; reason: string }[] = [
  { text: './start.sh', reason: 'a shell command stays the same in every language' }
];

type Finding = { file: string; line: number; text: string };

function filesOf(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return filesOf(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function literalOf(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ');
  if (ts.isJsxExpression(node)) return literalOf(node.expression);
  if (ts.isParenthesizedExpression(node)) return literalOf(node.expression);
  if (ts.isConditionalExpression(node)) return [literalOf(node.whenTrue), literalOf(node.whenFalse)].filter(text => text !== null).join(' ') || null;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return literalOf(node.right);
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [literalOf(node.left), literalOf(node.right)].filter(text => text !== null).join(' ') || null;
  }
  return null;
}

function childText(node: ts.JsxExpression): string | null {
  const expression = node.expression;
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isTemplateExpression(expression) || ts.isConditionalExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isBinaryExpression(expression)) return literalOf(expression);
  return null;
}

function allowed(text: string): boolean {
  const rest = ALLOWED.reduce((left, entry) => left.split(entry.text).join(' '), text);
  return !LETTER.test(rest);
}

function findingsOf(file: string): Finding[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];
  const report = (node: ts.Node, text: string | null) => {
    if (text === null || !LETTER.test(text) || allowed(text)) return;
    found.push({ file: relative(SOURCE, file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim() });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) report(node, childText(node));
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (TEXT_PROP.test(name) && !NOT_TEXT_PROP.has(name)) report(node, literalOf(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function allFindings(): Finding[] {
  return filesOf(SOURCE).flatMap(findingsOf);
}

describe('no literal text in the web screens', () => {
  it('has_no_jsx_text_or_text_prop_with_a_letter_outside_the_language_pack', () => {
    expect(allFindings().map(finding => `${finding.file}:${finding.line} ${finding.text}`)).toEqual([]);
  });

  for (const entry of ALLOWED) {
    it(`allows "${entry.text}" because ${entry.reason}`, () => {
      expect(filesOf(SOURCE).some(file => readFileSync(file, 'utf8').includes(entry.text))).toBe(true);
    });
  }
});
