/**
 * Other Language Import/Export Extractors
 *
 * Contains Python, C#, Go, and Rust import/export extraction logic,
 * split out from importExportExtractor.js for maintainability.
 */

// ============================================
// Utilities (used by extractors in this file)
// ============================================

function stripQuotes(str) {
  if (!str) return '';
  return str.replace(/^['"`]|['"`]$/g, '');
}

function findNameNode(node) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child.type === 'qualified_name' || child.type === 'identifier' ||
        child.type === 'name' || child.type === 'dotted_name') {
      return child;
    }
  }
  return null;
}

// ============================================
// Python Extractor
// ============================================

const pythonExtractor = {
  extractImports(rootNode) {
    const imports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      // import module
      if (node.type === 'import_statement') {
        const names = [];
        for (let j = 0; j < node.namedChildCount; j++) {
          const child = node.namedChild(j);
          if (child.type === 'dotted_name') {
            names.push(child.text);
          } else if (child.type === 'aliased_import') {
            const name = child.childForFieldName('name');
            if (name) names.push(name.text);
          }
        }
        for (const name of names) {
          imports.push({ source: name, symbols: ['*'], type: 'namespace', alias: null });
        }
      }

      // from module import a, b
      if (node.type === 'import_from_statement') {
        const moduleName = node.childForFieldName('module_name');
        const source = moduleName ? moduleName.text : '';
        const symbols = [];

        for (let j = 0; j < node.namedChildCount; j++) {
          const child = node.namedChild(j);
          if (child.type === 'dotted_name' && child !== moduleName) {
            symbols.push(child.text);
          } else if (child.type === 'aliased_import') {
            const name = child.childForFieldName('name');
            if (name) symbols.push(name.text);
          } else if (child.type === 'wildcard_import') {
            symbols.push('*');
          }
        }

        imports.push({ source, symbols, type: symbols.includes('*') ? 'namespace' : 'named', alias: null });
      }
    }

    return imports;
  },

  extractExports(rootNode) {
    // Python doesn't have explicit exports — everything at module level is public
    // We treat top-level function/class definitions as exports
    // Items starting with _ are conventionally private
    const exports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      if (node.type === 'function_definition') {
        const name = node.childForFieldName('name');
        if (name && !name.text.startsWith('_')) {
          exports.push({ name: name.text, kind: 'function', isDefault: false });
        }
      }

      if (node.type === 'class_definition') {
        const name = node.childForFieldName('name');
        if (name && !name.text.startsWith('_')) {
          exports.push({ name: name.text, kind: 'class', isDefault: false });
        }
      }

      if (node.type === 'decorated_definition') {
        // Check inner definition
        for (let j = 0; j < node.namedChildCount; j++) {
          const inner = node.namedChild(j);
          if (inner.type === 'function_definition' || inner.type === 'class_definition') {
            const name = inner.childForFieldName('name');
            if (name && !name.text.startsWith('_')) {
              exports.push({
                name: name.text,
                kind: inner.type === 'function_definition' ? 'function' : 'class',
                isDefault: false
              });
            }
          }
        }
      }

      // Assignment: SOME_CONSTANT = value (uppercase = public constant convention)
      if (node.type === 'assignment' || node.type === 'expression_statement') {
        const target = node.type === 'assignment'
          ? node.childForFieldName('left')
          : null;
        if (target && target.type === 'identifier' && !target.text.startsWith('_')) {
          if (target.text === target.text.toUpperCase() && target.text.length > 1) {
            exports.push({ name: target.text, kind: 'variable', isDefault: false });
          }
        }
      }
    }

    return exports;
  }
};

// ============================================
// C# Extractor
// ============================================

const csharpExtractor = {
  extractImports(rootNode) {
    const imports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);
      if (node.type === 'using_directive') {
        const nameNode = findNameNode(node);
        if (nameNode) {
          imports.push({
            source: nameNode.text,
            symbols: ['*'],
            type: 'namespace',
            alias: null
          });
        }
      }
    }

    return imports;
  },

  extractExports(rootNode) {
    const exports = [];
    walkCSharpExports(rootNode, exports);
    return exports;
  }
};

function walkCSharpExports(node, exports) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);

    if (child.type === 'namespace_declaration') {
      walkCSharpExports(child, exports);
      continue;
    }

    const isPublic = child.text.substring(0, 80).includes('public');
    if (!isPublic) continue;

    if (child.type === 'class_declaration') {
      const name = child.childForFieldName('name');
      if (name) exports.push({ name: name.text, kind: 'class', isDefault: false });
    }
    if (child.type === 'interface_declaration') {
      const name = child.childForFieldName('name');
      if (name) exports.push({ name: name.text, kind: 'interface', isDefault: false });
    }
    if (child.type === 'struct_declaration') {
      const name = child.childForFieldName('name');
      if (name) exports.push({ name: name.text, kind: 'struct', isDefault: false });
    }
    if (child.type === 'enum_declaration') {
      const name = child.childForFieldName('name');
      if (name) exports.push({ name: name.text, kind: 'enum', isDefault: false });
    }
  }
}

// ============================================
// Go Extractor
// ============================================

const goExtractor = {
  extractImports(rootNode) {
    const imports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);
      if (node.type === 'import_declaration') {
        // Single import or import block
        for (let j = 0; j < node.namedChildCount; j++) {
          const child = node.namedChild(j);
          if (child.type === 'import_spec') {
            const pathNode = child.childForFieldName('path');
            if (pathNode) {
              imports.push({
                source: stripQuotes(pathNode.text),
                symbols: ['*'],
                type: 'namespace',
                alias: null
              });
            }
          }
          if (child.type === 'import_spec_list') {
            for (let k = 0; k < child.namedChildCount; k++) {
              const spec = child.namedChild(k);
              if (spec.type === 'import_spec') {
                const pathNode = spec.childForFieldName('path');
                if (pathNode) {
                  imports.push({
                    source: stripQuotes(pathNode.text),
                    symbols: ['*'],
                    type: 'namespace',
                    alias: null
                  });
                }
              }
            }
          }
          // Interpreted string literal (bare import)
          if (child.type === 'interpreted_string_literal') {
            imports.push({
              source: stripQuotes(child.text),
              symbols: ['*'],
              type: 'namespace',
              alias: null
            });
          }
        }
      }
    }

    return imports;
  },

  extractExports(rootNode) {
    const exports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      // Go exports are capitalized identifiers
      if (node.type === 'function_declaration') {
        const name = node.childForFieldName('name');
        if (name && /^[A-Z]/.test(name.text)) {
          exports.push({ name: name.text, kind: 'function', isDefault: false });
        }
      }

      if (node.type === 'method_declaration') {
        const name = node.childForFieldName('name');
        if (name && /^[A-Z]/.test(name.text)) {
          exports.push({ name: name.text, kind: 'function', isDefault: false });
        }
      }

      if (node.type === 'type_declaration') {
        for (let j = 0; j < node.namedChildCount; j++) {
          const spec = node.namedChild(j);
          if (spec.type === 'type_spec') {
            const name = spec.childForFieldName('name');
            if (name && /^[A-Z]/.test(name.text)) {
              const typeNode = spec.childForFieldName('type');
              const kind = typeNode && typeNode.type.includes('struct') ? 'struct' :
                           typeNode && typeNode.type.includes('interface') ? 'interface' : 'type';
              exports.push({ name: name.text, kind, isDefault: false });
            }
          }
        }
      }
    }

    return exports;
  }
};

// ============================================
// Rust Extractor
// ============================================

const rustExtractor = {
  extractImports(rootNode) {
    const imports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);

      if (node.type === 'use_declaration') {
        const pathText = extractRustUsePath(node);
        if (pathText) {
          imports.push({
            source: pathText.module,
            symbols: pathText.symbols,
            type: pathText.symbols.includes('*') ? 'namespace' : 'named',
            alias: null
          });
        }
      }

      if (node.type === 'extern_crate_declaration') {
        const name = node.childForFieldName('name');
        if (name) {
          imports.push({
            source: name.text,
            symbols: ['*'],
            type: 'namespace',
            alias: null
          });
        }
      }
    }

    return imports;
  },

  extractExports(rootNode) {
    const exports = [];

    for (let i = 0; i < rootNode.namedChildCount; i++) {
      const node = rootNode.namedChild(i);
      const isPub = node.text.substring(0, 20).startsWith('pub');

      if (!isPub) continue;

      if (node.type === 'function_item') {
        const name = node.childForFieldName('name');
        if (name) exports.push({ name: name.text, kind: 'function', isDefault: false });
      }
      if (node.type === 'struct_item') {
        const name = node.childForFieldName('name');
        if (name) exports.push({ name: name.text, kind: 'struct', isDefault: false });
      }
      if (node.type === 'enum_item') {
        const name = node.childForFieldName('name');
        if (name) exports.push({ name: name.text, kind: 'enum', isDefault: false });
      }
      if (node.type === 'trait_item') {
        const name = node.childForFieldName('name');
        if (name) exports.push({ name: name.text, kind: 'trait', isDefault: false });
      }
      if (node.type === 'impl_item') {
        const name = node.childForFieldName('type');
        if (name) exports.push({ name: name.text, kind: 'impl', isDefault: false });
      }
      if (node.type === 'mod_item') {
        const name = node.childForFieldName('name');
        if (name) exports.push({ name: name.text, kind: 'module', isDefault: false });
      }
    }

    return exports;
  }
};

function extractRustUsePath(node) {
  // Extract use path text and parse into module + symbols
  const text = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim();

  // use crate::module::{A, B}
  const braceMatch = text.match(/^(.+?)::\{(.+)\}$/);
  if (braceMatch) {
    const module = braceMatch[1];
    const symbols = braceMatch[2].split(',').map(s => s.trim());
    return { module, symbols };
  }

  // use crate::module::*
  if (text.endsWith('::*')) {
    return { module: text.replace(/::?\*$/, ''), symbols: ['*'] };
  }

  // use crate::module::Item
  const lastColon = text.lastIndexOf('::');
  if (lastColon > -1) {
    return {
      module: text.substring(0, lastColon),
      symbols: [text.substring(lastColon + 2)]
    };
  }

  return { module: text, symbols: ['*'] };
}

module.exports = {
  pythonExtractor,
  csharpExtractor,
  goExtractor,
  rustExtractor
};
