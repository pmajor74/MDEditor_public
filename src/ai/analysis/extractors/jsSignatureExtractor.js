/**
 * JavaScript/TypeScript Signature Extractor
 *
 * Contains all JS/TS-specific function/method signature extraction logic,
 * split out from jsExtractor.js for maintainability.
 */

// ============================================
// Signature Extraction
// ============================================

function extractJSSignatures(rootNode, lines, filePath) {
  const signatures = [];

  function walkNode(node, isExported) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      // export statement wraps a declaration
      if (child.type === 'export_statement') {
        walkNode(child, true);
        continue;
      }

      // function declaration
      if (child.type === 'function_declaration' || child.type === 'generator_function_declaration') {
        const sig = extractJSFunctionSig(child, lines, filePath, isExported || isNodeExported(child));
        if (sig) signatures.push(sig);
      }

      // class declaration — extract methods
      if (child.type === 'class_declaration') {
        extractClassMethods(child, lines, filePath, isExported || isNodeExported(child), signatures);
      }

      // Variable/lexical declaration with arrow function
      if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        for (let j = 0; j < child.namedChildCount; j++) {
          const decl = child.namedChild(j);
          if (decl.type === 'variable_declarator') {
            const init = decl.childForFieldName('value') || decl.childForFieldName('init');
            if (init && (init.type === 'arrow_function' || init.type === 'function_expression')) {
              const nameNode = decl.childForFieldName('name');
              if (nameNode) {
                const sig = extractArrowSig(nameNode.text, init, child, lines, filePath, isExported || isNodeExported(node));
                if (sig) signatures.push(sig);
              }
            }
          }
        }
      }
    }
  }

  walkNode(rootNode, false);
  return signatures;
}

function extractJSFunctionSig(node, lines, filePath, isExported) {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const params = extractJSParams(node);
  const returnType = extractJSReturnType(node, lines);
  const jsdoc = extractJSDocComment(node, lines);
  const isAsyncFn = /\basync\b/.test(node.text.substring(0, 100));
  const isGenerator = node.type === 'generator_function_declaration';

  return {
    name: nameNode.text,
    kind: isGenerator ? 'generator' : 'function',
    isExported,
    isAsync: isAsyncFn,
    parameters: params,
    returnType: returnType || (jsdoc?.returns) || null,
    jsdocSummary: jsdoc?.summary || null,
    filePath: filePath.replace(/\\/g, '/'),
    startLine: node.startPosition.row + 1
  };
}

function extractArrowSig(name, arrowNode, parentNode, lines, filePath, isExported) {
  const params = extractJSParams(arrowNode);
  const returnType = extractJSReturnType(arrowNode, lines);
  const jsdoc = extractJSDocComment(parentNode, lines);
  const isAsyncFn = /\basync\b/.test(arrowNode.text.substring(0, 50));

  return {
    name,
    kind: 'function',
    isExported,
    isAsync: isAsyncFn,
    parameters: params,
    returnType: returnType || (jsdoc?.returns) || null,
    jsdocSummary: jsdoc?.summary || null,
    filePath: filePath.replace(/\\/g, '/'),
    startLine: parentNode.startPosition.row + 1
  };
}

function extractClassMethods(classNode, lines, filePath, isClassExported, signatures) {
  const className = classNode.childForFieldName('name');
  const classNameText = className ? className.text : 'Anonymous';

  const body = classNode.childForFieldName('body');
  if (!body) return;

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);

    if (member.type === 'method_definition') {
      const nameNode = member.childForFieldName('name');
      if (!nameNode) continue;

      const params = extractJSParams(member);
      const returnType = extractJSReturnType(member, lines);
      const jsdoc = extractJSDocComment(member, lines);
      const isAsyncFn = /\basync\b/.test(member.text.substring(0, 50));
      const isStatic = member.text.substring(0, 30).includes('static');

      signatures.push({
        name: `${classNameText}.${nameNode.text}`,
        kind: 'method',
        isExported: isClassExported,
        isAsync: isAsyncFn,
        isStatic,
        parameters: params,
        returnType: returnType || (jsdoc?.returns) || null,
        jsdocSummary: jsdoc?.summary || null,
        filePath: filePath.replace(/\\/g, '/'),
        startLine: member.startPosition.row + 1
      });
    }
  }
}

function extractJSParams(node) {
  const params = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);

    if (param.type === 'identifier') {
      params.push({ name: param.text, type: null, hasDefault: false });
    } else if (param.type === 'assignment_pattern') {
      const left = param.childForFieldName('left');
      params.push({ name: left ? left.text : param.text, type: null, hasDefault: true });
    } else if (param.type === 'rest_pattern' || param.type === 'rest_element') {
      const argName = param.namedChildCount > 0 ? param.namedChild(0).text : param.text;
      params.push({ name: `...${argName}`, type: null, hasDefault: false });
    } else if (param.type === 'object_pattern') {
      params.push({ name: '{ destructured }', type: null, hasDefault: false });
    } else if (param.type === 'array_pattern') {
      params.push({ name: '[ destructured ]', type: null, hasDefault: false });
    }
    // TypeScript: required_parameter, optional_parameter
    else if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
      const nameNode = param.childForFieldName('pattern') || param.childForFieldName('name');
      const typeNode = param.childForFieldName('type');
      params.push({
        name: nameNode ? nameNode.text : param.text,
        type: typeNode ? typeNode.text.replace(/^:\s*/, '') : null,
        hasDefault: param.type === 'optional_parameter'
      });
    }
  }

  return params;
}

function extractJSReturnType(node, lines) {
  // TypeScript return type annotation
  const returnType = node.childForFieldName('return_type');
  if (returnType) {
    return returnType.text.replace(/^:\s*/, '');
  }
  return null;
}

function extractJSDocComment(node, lines) {
  const startRow = node.startPosition.row;
  let commentText = '';

  // Look backwards for JSDoc comment
  for (let row = startRow - 1; row >= Math.max(0, startRow - 30); row--) {
    const line = lines[row].trim();
    if (line === '') continue;
    if (line.startsWith('*') || line.startsWith('/**') || line.startsWith('*/') || line.startsWith('//')) {
      commentText = line + '\n' + commentText;
      if (line.startsWith('/**') || line.startsWith('//')) break;
    } else {
      break;
    }
  }

  if (!commentText) return null;

  // Extract summary (first line after /**)
  const summaryMatch = commentText.match(/\/\*\*\s*\n?\s*\*?\s*(.+?)(?:\n|$)/);
  const summary = summaryMatch ? summaryMatch[1].replace(/^\s*\*\s*/, '').trim() : null;

  // Extract @returns type
  const returnsMatch = commentText.match(/@returns?\s+\{([^}]+)\}/);
  const returns = returnsMatch ? returnsMatch[1] : null;

  // Extract @param types to supplement parameter info
  const paramTypes = {};
  const paramRegex = /@param\s+\{([^}]+)\}\s+(\w+)/g;
  let match;
  while ((match = paramRegex.exec(commentText)) !== null) {
    paramTypes[match[2]] = match[1];
  }

  return { summary, returns, paramTypes };
}

function isNodeExported(node) {
  if (node.type === 'export_statement') return true;
  if (node.parent && node.parent.type === 'export_statement') return true;
  const text = node.text.substring(0, 50);
  return /^export\s/.test(text);
}

module.exports = {
  extractJSSignatures
};
