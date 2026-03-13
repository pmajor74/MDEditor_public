/**
 * Other Language Signature Extractors
 *
 * Contains Python, C#, Go, and Rust function/method signature extraction logic,
 * split out from signatureExtractor.js for maintainability.
 */

// ============================================
// Python Signature Extractor
// ============================================

function extractPythonSignatures(rootNode, lines, filePath) {
  const signatures = [];

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);

    if (node.type === 'function_definition') {
      const sig = extractPythonFuncSig(node, lines, filePath, true);
      if (sig) signatures.push(sig);
    }

    if (node.type === 'class_definition') {
      extractPythonClassMethods(node, lines, filePath, signatures);
    }

    if (node.type === 'decorated_definition') {
      for (let j = 0; j < node.namedChildCount; j++) {
        const inner = node.namedChild(j);
        if (inner.type === 'function_definition') {
          const sig = extractPythonFuncSig(inner, lines, filePath, true);
          if (sig) signatures.push(sig);
        }
        if (inner.type === 'class_definition') {
          extractPythonClassMethods(inner, lines, filePath, signatures);
        }
      }
    }
  }

  return signatures;
}

function extractPythonFuncSig(node, lines, filePath, isExported) {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;
  if (nameNode.text.startsWith('_') && !nameNode.text.startsWith('__')) {
    isExported = false;
  }

  const params = extractPythonParams(node);
  const returnType = node.childForFieldName('return_type');
  const isAsyncFn = node.text.substring(0, 20).startsWith('async');
  const docstring = extractPythonDocstring(node, lines);

  return {
    name: nameNode.text,
    kind: 'function',
    isExported,
    isAsync: isAsyncFn,
    parameters: params,
    returnType: returnType ? returnType.text.replace(/^->\s*/, '') : null,
    jsdocSummary: docstring,
    filePath: filePath.replace(/\\/g, '/'),
    startLine: node.startPosition.row + 1
  };
}

function extractPythonClassMethods(classNode, lines, filePath, signatures) {
  const className = classNode.childForFieldName('name');
  const classNameText = className ? className.text : 'Unknown';

  const body = classNode.childForFieldName('body');
  if (!body) return;

  for (let i = 0; i < body.namedChildCount; i++) {
    const member = body.namedChild(i);
    let funcNode = member;

    if (member.type === 'decorated_definition') {
      for (let j = 0; j < member.namedChildCount; j++) {
        if (member.namedChild(j).type === 'function_definition') {
          funcNode = member.namedChild(j);
          break;
        }
      }
    }

    if (funcNode.type !== 'function_definition') continue;

    const nameNode = funcNode.childForFieldName('name');
    if (!nameNode) continue;

    const params = extractPythonParams(funcNode).filter(p => p.name !== 'self' && p.name !== 'cls');
    const returnType = funcNode.childForFieldName('return_type');
    const isAsyncFn = funcNode.text.substring(0, 20).startsWith('async');
    const docstring = extractPythonDocstring(funcNode, lines);

    signatures.push({
      name: `${classNameText}.${nameNode.text}`,
      kind: 'method',
      isExported: !nameNode.text.startsWith('_'),
      isAsync: isAsyncFn,
      parameters: params,
      returnType: returnType ? returnType.text.replace(/^->\s*/, '') : null,
      jsdocSummary: docstring,
      filePath: filePath.replace(/\\/g, '/'),
      startLine: funcNode.startPosition.row + 1
    });
  }
}

function extractPythonParams(node) {
  const params = [];
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return params;

  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);

    if (param.type === 'identifier') {
      params.push({ name: param.text, type: null, hasDefault: false });
    } else if (param.type === 'typed_parameter') {
      const name = param.childForFieldName('name') || param.namedChild(0);
      const type = param.childForFieldName('type');
      params.push({
        name: name ? name.text : param.text,
        type: type ? type.text : null,
        hasDefault: false
      });
    } else if (param.type === 'default_parameter') {
      const name = param.childForFieldName('name');
      params.push({
        name: name ? name.text : param.text,
        type: null,
        hasDefault: true
      });
    } else if (param.type === 'typed_default_parameter') {
      const name = param.childForFieldName('name');
      const type = param.childForFieldName('type');
      params.push({
        name: name ? name.text : param.text,
        type: type ? type.text : null,
        hasDefault: true
      });
    } else if (param.type === 'list_splat_pattern') {
      params.push({ name: `*${param.text.replace('*', '')}`, type: null, hasDefault: false });
    } else if (param.type === 'dictionary_splat_pattern') {
      params.push({ name: `**${param.text.replace('**', '')}`, type: null, hasDefault: false });
    }
  }

  return params;
}

function extractPythonDocstring(node, lines) {
  const body = node.childForFieldName('body');
  if (!body || body.namedChildCount === 0) return null;

  const firstChild = body.namedChild(0);
  if (firstChild.type === 'expression_statement') {
    const expr = firstChild.namedChildCount > 0 ? firstChild.namedChild(0) : null;
    if (expr && (expr.type === 'string' || expr.type === 'concatenated_string')) {
      const text = expr.text.replace(/^['"`]{1,3}|['"`]{1,3}$/g, '').trim();
      // Return first line only
      return text.split('\n')[0].trim();
    }
  }

  return null;
}

// ============================================
// C# Signature Extractor
// ============================================

function extractCSharpSignatures(rootNode, lines, filePath) {
  const signatures = [];
  walkCSharpSignatures(rootNode, lines, filePath, signatures, null);
  return signatures;
}

function walkCSharpSignatures(node, lines, filePath, signatures, className) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);

    if (child.type === 'namespace_declaration') {
      walkCSharpSignatures(child, lines, filePath, signatures, className);
      continue;
    }

    if (child.type === 'class_declaration' || child.type === 'struct_declaration') {
      const name = child.childForFieldName('name');
      walkCSharpSignatures(child, lines, filePath, signatures, name ? name.text : className);
      continue;
    }

    if (child.type === 'method_declaration') {
      const nameNode = child.childForFieldName('name');
      const returnType = child.childForFieldName('type');
      const isPublic = child.text.substring(0, 80).includes('public');
      const isStatic = child.text.substring(0, 80).includes('static');
      const isAsyncFn = child.text.substring(0, 80).includes('async');

      if (nameNode) {
        const fullName = className ? `${className}.${nameNode.text}` : nameNode.text;
        signatures.push({
          name: fullName,
          kind: 'method',
          isExported: isPublic,
          isAsync: isAsyncFn,
          isStatic,
          parameters: extractCSharpParams(child),
          returnType: returnType ? returnType.text : null,
          jsdocSummary: extractXmlDocComment(child, lines),
          filePath: filePath.replace(/\\/g, '/'),
          startLine: child.startPosition.row + 1
        });
      }
    }
  }
}

function extractCSharpParams(node) {
  const params = [];
  const paramList = node.childForFieldName('parameters');
  if (!paramList) return params;

  for (let i = 0; i < paramList.namedChildCount; i++) {
    const param = paramList.namedChild(i);
    if (param.type === 'parameter') {
      const type = param.childForFieldName('type');
      const name = param.childForFieldName('name');
      params.push({
        name: name ? name.text : param.text,
        type: type ? type.text : null,
        hasDefault: param.text.includes('=')
      });
    }
  }

  return params;
}

function extractXmlDocComment(node, lines) {
  const startRow = node.startPosition.row;
  let commentLines = [];

  for (let row = startRow - 1; row >= Math.max(0, startRow - 15); row--) {
    const line = lines[row].trim();
    if (line.startsWith('///')) {
      commentLines.unshift(line.replace(/^\/\/\/\s*/, ''));
    } else if (line === '') {
      continue;
    } else {
      break;
    }
  }

  if (commentLines.length === 0) return null;

  // Extract <summary> content
  const full = commentLines.join(' ');
  const summaryMatch = full.match(/<summary>\s*(.*?)\s*<\/summary>/s);
  return summaryMatch ? summaryMatch[1].trim() : commentLines[0].replace(/<[^>]+>/g, '').trim();
}

// ============================================
// Go Signature Extractor
// ============================================

function extractGoSignatures(rootNode, lines, filePath) {
  const signatures = [];

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);

    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;

      const params = extractGoParams(node.childForFieldName('parameters'));
      const result = node.childForFieldName('result');

      signatures.push({
        name: nameNode.text,
        kind: 'function',
        isExported: /^[A-Z]/.test(nameNode.text),
        isAsync: false,
        parameters: params,
        returnType: result ? result.text : null,
        jsdocSummary: extractGoComment(node, lines),
        filePath: filePath.replace(/\\/g, '/'),
        startLine: node.startPosition.row + 1
      });
    }

    if (node.type === 'method_declaration') {
      const nameNode = node.childForFieldName('name');
      const receiver = node.childForFieldName('receiver');
      if (!nameNode) continue;

      const receiverType = receiver ? receiver.text.replace(/[()]/g, '').trim().split(/\s+/).pop() : null;
      const params = extractGoParams(node.childForFieldName('parameters'));
      const result = node.childForFieldName('result');

      signatures.push({
        name: receiverType ? `${receiverType.replace('*', '')}.${nameNode.text}` : nameNode.text,
        kind: 'method',
        isExported: /^[A-Z]/.test(nameNode.text),
        isAsync: false,
        parameters: params,
        returnType: result ? result.text : null,
        jsdocSummary: extractGoComment(node, lines),
        filePath: filePath.replace(/\\/g, '/'),
        startLine: node.startPosition.row + 1
      });
    }
  }

  return signatures;
}

function extractGoParams(paramList) {
  const params = [];
  if (!paramList) return params;

  for (let i = 0; i < paramList.namedChildCount; i++) {
    const param = paramList.namedChild(i);
    if (param.type === 'parameter_declaration') {
      const name = param.childForFieldName('name');
      const type = param.childForFieldName('type');
      params.push({
        name: name ? name.text : `arg${i}`,
        type: type ? type.text : null,
        hasDefault: false
      });
    }
  }

  return params;
}

function extractGoComment(node, lines) {
  const startRow = node.startPosition.row;
  let commentLines = [];

  for (let row = startRow - 1; row >= Math.max(0, startRow - 10); row--) {
    const line = lines[row].trim();
    if (line.startsWith('//')) {
      commentLines.unshift(line.replace(/^\/\/\s*/, ''));
    } else if (line === '') {
      continue;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines[0] : null;
}

// ============================================
// Rust Signature Extractor
// ============================================

function extractRustSignatures(rootNode, lines, filePath) {
  const signatures = [];

  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);

    if (node.type === 'function_item') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;

      const isPub = node.text.substring(0, 20).startsWith('pub');
      const isAsyncFn = node.text.substring(0, 30).includes('async');
      const params = extractRustParams(node);
      const returnType = node.childForFieldName('return_type');

      signatures.push({
        name: nameNode.text,
        kind: 'function',
        isExported: isPub,
        isAsync: isAsyncFn,
        parameters: params,
        returnType: returnType ? returnType.text.replace(/^->\s*/, '') : null,
        jsdocSummary: extractRustDocComment(node, lines),
        filePath: filePath.replace(/\\/g, '/'),
        startLine: node.startPosition.row + 1
      });
    }

    // Methods inside impl blocks
    if (node.type === 'impl_item') {
      const typeNode = node.childForFieldName('type');
      const typeName = typeNode ? typeNode.text : null;
      const body = node.childForFieldName('body');
      if (!body) continue;

      for (let j = 0; j < body.namedChildCount; j++) {
        const member = body.namedChild(j);
        if (member.type === 'function_item') {
          const nameNode = member.childForFieldName('name');
          if (!nameNode) continue;

          const isPub = member.text.substring(0, 20).startsWith('pub');
          const isAsyncFn = member.text.substring(0, 30).includes('async');
          const params = extractRustParams(member).filter(p => p.name !== 'self' && p.name !== '&self' && p.name !== '&mut self');
          const returnType = member.childForFieldName('return_type');

          signatures.push({
            name: typeName ? `${typeName}::${nameNode.text}` : nameNode.text,
            kind: 'method',
            isExported: isPub,
            isAsync: isAsyncFn,
            parameters: params,
            returnType: returnType ? returnType.text.replace(/^->\s*/, '') : null,
            jsdocSummary: extractRustDocComment(member, lines),
            filePath: filePath.replace(/\\/g, '/'),
            startLine: member.startPosition.row + 1
          });
        }
      }
    }
  }

  return signatures;
}

function extractRustParams(node) {
  const params = [];
  const paramList = node.childForFieldName('parameters');
  if (!paramList) return params;

  for (let i = 0; i < paramList.namedChildCount; i++) {
    const param = paramList.namedChild(i);
    if (param.type === 'parameter') {
      const pattern = param.childForFieldName('pattern');
      const type = param.childForFieldName('type');
      params.push({
        name: pattern ? pattern.text : param.text,
        type: type ? type.text : null,
        hasDefault: false
      });
    } else if (param.type === 'self_parameter') {
      params.push({ name: param.text, type: null, hasDefault: false });
    }
  }

  return params;
}

function extractRustDocComment(node, lines) {
  const startRow = node.startPosition.row;
  let commentLines = [];

  for (let row = startRow - 1; row >= Math.max(0, startRow - 15); row--) {
    const line = lines[row].trim();
    if (line.startsWith('///') || line.startsWith('//!')) {
      commentLines.unshift(line.replace(/^\/\/[\/!]\s*/, ''));
    } else if (line === '') {
      continue;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines[0] : null;
}

module.exports = {
  extractPythonSignatures,
  extractCSharpSignatures,
  extractGoSignatures,
  extractRustSignatures
};
