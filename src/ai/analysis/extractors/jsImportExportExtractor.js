/**
 * JavaScript/TypeScript Import/Export Extractor
 *
 * Contains all JS/TS-specific import/export extraction logic,
 * split out from jsExtractor.js for maintainability.
 */

// ============================================
// Import/Export Extraction
// ============================================

const jsImportExportExtractor = {
  extractImports(rootNode, content) {
    const imports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      // ES6 import statements
      if (node.type === 'import_statement') {
        const imp = parseESImport(node);
        if (imp) imports.push(imp);
      }

      // CommonJS require: const x = require('y')
      if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
        const reqs = parseRequireDeclaration(node);
        imports.push(...reqs);
      }

      // Expression statement: require('x') or module.exports = require('x')
      if (node.type === 'expression_statement') {
        const reqs = parseExpressionRequire(node);
        imports.push(...reqs);
      }
    }

    return imports;
  },

  extractExports(rootNode, content) {
    const exports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      // ES6 export
      if (node.type === 'export_statement') {
        const exps = parseESExport(node);
        exports.push(...exps);
      }

      // module.exports = { ... } or module.exports.x = ...
      if (node.type === 'expression_statement') {
        const exps = parseModuleExports(node);
        exports.push(...exps);
      }
    }

    return exports;
  }
};

function parseESImport(node) {
  const sourceNode = node.childForFieldName('source');
  if (!sourceNode) return null;

  const source = stripQuotes(sourceNode.text);
  const symbols = [];
  let type = 'named';
  let alias = null;

  // Walk children to find import clause
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);

    if (child.type === 'import_clause') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const clauseChild = child.namedChild(j);

        // Default import: import Foo from 'x'
        if (clauseChild.type === 'identifier') {
          symbols.push(clauseChild.text);
          type = 'default';
        }

        // Named imports: import { a, b } from 'x'
        if (clauseChild.type === 'named_imports') {
          type = 'named';
          for (let k = 0; k < clauseChild.namedChildCount; k++) {
            const spec = clauseChild.namedChild(k);
            if (spec.type === 'import_specifier') {
              const nameNode = spec.childForFieldName('name');
              const aliasNode = spec.childForFieldName('alias');
              symbols.push(nameNode ? nameNode.text : spec.text);
            }
          }
        }

        // Namespace import: import * as foo from 'x'
        if (clauseChild.type === 'namespace_import') {
          type = 'namespace';
          symbols.push('*');
          // Look for alias identifier
          for (let k = 0; k < clauseChild.namedChildCount; k++) {
            if (clauseChild.namedChild(k).type === 'identifier') {
              alias = clauseChild.namedChild(k).text;
            }
          }
        }
      }
    }
  }

  // Side-effect import: import 'x'
  if (symbols.length === 0) {
    type = 'side-effect';
  }

  return { source, symbols, type, alias };
}

function parseRequireDeclaration(node) {
  const imports = [];

  for (let i = 0; i < node.namedChildCount; i++) {
    const declarator = node.namedChild(i);
    if (declarator.type !== 'variable_declarator') continue;

    const init = declarator.childForFieldName('value') || declarator.childForFieldName('init');
    if (!init) continue;

    const source = extractRequireSource(init);
    if (!source) continue;

    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) continue;

    // Destructured require: const { a, b } = require('x')
    if (nameNode.type === 'object_pattern') {
      const symbols = [];
      for (let j = 0; j < nameNode.namedChildCount; j++) {
        const prop = nameNode.namedChild(j);
        if (prop.type === 'shorthand_property_identifier_pattern' || prop.type === 'shorthand_property_identifier') {
          symbols.push(prop.text);
        } else if (prop.type === 'pair_pattern' || prop.type === 'pair') {
          const key = prop.childForFieldName('key');
          if (key) symbols.push(key.text);
        }
      }
      imports.push({ source, symbols, type: 'named', alias: null });
    } else {
      // Simple require: const x = require('y')
      imports.push({ source, symbols: [nameNode.text], type: 'default', alias: null });
    }
  }

  return imports;
}

function parseExpressionRequire(node) {
  const imports = [];
  const expr = node.namedChildCount > 0 ? node.namedChild(0) : null;
  if (!expr) return imports;

  // Bare require('x')
  const source = extractRequireSource(expr);
  if (source) {
    imports.push({ source, symbols: [], type: 'side-effect', alias: null });
  }

  return imports;
}

function extractRequireSource(node) {
  if (!node) return null;

  // Direct require call: require('x')
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn && fn.text === 'require') {
      const args = node.childForFieldName('arguments');
      if (args && args.namedChildCount > 0) {
        return stripQuotes(args.namedChild(0).text);
      }
    }
  }

  return null;
}

function parseESExport(node) {
  const exports = [];
  const text = node.text;

  // export default
  const isDefault = text.startsWith('export default');

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);

    // export function foo() {}
    if (child.type === 'function_declaration' || child.type === 'generator_function_declaration') {
      const name = child.childForFieldName('name');
      exports.push({
        name: name ? name.text : 'default',
        kind: 'function',
        isDefault
      });
    }

    // export class Foo {}
    if (child.type === 'class_declaration') {
      const name = child.childForFieldName('name');
      exports.push({
        name: name ? name.text : 'default',
        kind: 'class',
        isDefault
      });
    }

    // export const x = ...
    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const decl = child.namedChild(j);
        if (decl.type === 'variable_declarator') {
          const name = decl.childForFieldName('name');
          if (name) {
            const initNode = decl.childForFieldName('value') || decl.childForFieldName('init');
            const kind = isArrowOrFunction(initNode) ? 'function' : 'variable';
            exports.push({ name: name.text, kind, isDefault });
          }
        }
      }
    }

    // export { a, b, c }
    if (child.type === 'export_clause') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const spec = child.namedChild(j);
        if (spec.type === 'export_specifier') {
          const name = spec.childForFieldName('name');
          exports.push({
            name: name ? name.text : spec.text,
            kind: 'unknown',
            isDefault: false
          });
        }
      }
    }

    // export default expression
    if (isDefault && child.type === 'identifier') {
      exports.push({ name: child.text, kind: 'unknown', isDefault: true });
    }
  }

  // export default <anonymous>
  if (isDefault && exports.length === 0) {
    exports.push({ name: 'default', kind: 'unknown', isDefault: true });
  }

  return exports;
}

function parseModuleExports(node) {
  const exports = [];
  const expr = node.namedChildCount > 0 ? node.namedChild(0) : null;
  if (!expr) return exports;

  // module.exports = { a, b } or module.exports = function() {}
  if (expr.type === 'assignment_expression') {
    const left = expr.childForFieldName('left');
    const right = expr.childForFieldName('right');

    if (!left || !right) return exports;
    const leftText = left.text;

    // module.exports = { ... }
    if (leftText === 'module.exports' && right.type === 'object') {
      for (let i = 0; i < right.namedChildCount; i++) {
        const prop = right.namedChild(i);
        if (prop.type === 'shorthand_property') {
          exports.push({ name: prop.text, kind: 'unknown', isDefault: false });
        } else if (prop.type === 'pair') {
          const key = prop.childForFieldName('key');
          const value = prop.childForFieldName('value');
          if (key) {
            const kind = isArrowOrFunction(value) ? 'function' : 'unknown';
            exports.push({ name: key.text, kind, isDefault: false });
          }
        } else if (prop.type === 'method_definition') {
          const name = prop.childForFieldName('name');
          if (name) exports.push({ name: name.text, kind: 'function', isDefault: false });
        }
      }
    }

    // module.exports.foo = ...
    if (leftText.startsWith('module.exports.')) {
      const name = leftText.replace('module.exports.', '');
      const kind = isArrowOrFunction(right) ? 'function' : 'variable';
      exports.push({ name, kind, isDefault: false });
    }

    // exports.foo = ...
    if (leftText.startsWith('exports.') && !leftText.startsWith('exports.__')) {
      const name = leftText.replace('exports.', '');
      const kind = isArrowOrFunction(right) ? 'function' : 'variable';
      exports.push({ name, kind, isDefault: false });
    }
  }

  return exports;
}

function isArrowOrFunction(node) {
  if (!node) return false;
  return node.type === 'arrow_function' ||
         node.type === 'function_expression' ||
         node.type === 'function';
}

// ============================================
// Utility
// ============================================

function stripQuotes(str) {
  if (!str) return '';
  return str.replace(/^['"`]|['"`]$/g, '');
}

module.exports = {
  jsImportExportExtractor
};
