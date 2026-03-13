/**
 * Directory Structure Analyzer
 *
 * Static analysis of the file tree to identify modules, organizational
 * patterns, and project structure. No LLM calls needed.
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Analyze the directory structure of a project
 * @param {string[]} rootPaths - Root paths to analyze
 * @param {Object} [options] - Options
 * @param {string[]} [options.extensions] - File extensions to consider
 * @returns {Promise<Object>} Directory analysis
 */
async function analyzeDirectoryStructure(rootPaths, options = {}) {
  const { extensions = [] } = options;
  const extensionSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));

  const modules = [];
  const allFiles = [];
  const configFiles = [];
  const testDirs = [];
  const entryPoints = [];
  let buildTool = null;

  for (const rootPath of rootPaths) {
    await scanDirectory(rootPath, rootPath, {
      modules,
      allFiles,
      configFiles,
      testDirs,
      entryPoints,
      extensionSet,
      depth: 0
    });

    // Detect build tool from config files
    if (!buildTool) {
      buildTool = await detectBuildTool(rootPath);
    }
  }

  // Detect entry points
  const detectedEntries = detectEntryPoints(allFiles, rootPaths);
  entryPoints.push(...detectedEntries);

  // Detect language distribution
  const languageBreakdown = computeLanguageBreakdown(allFiles);

  return {
    modules,
    patterns: {
      hasTests: testDirs.length > 0,
      testDirs: testDirs.map(d => d.replace(/\\/g, '/')),
      buildTool,
      entryPoints: [...new Set(entryPoints)].map(e => e.replace(/\\/g, '/')),
      configFiles: configFiles.map(f => f.replace(/\\/g, '/'))
    },
    stats: {
      totalFiles: allFiles.length,
      languageBreakdown
    }
  };
}

/**
 * Recursively scan a directory and build module info
 */
async function scanDirectory(dirPath, rootPath, ctx, currentDepth = 0) {
  if (currentDepth > 6) return; // Max depth

  const dirName = path.basename(dirPath);

  // Skip common non-source directories
  if (SKIP_DIRS.has(dirName) || dirName.startsWith('.')) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  const files = [];
  const subdirs = [];
  let hasIndex = false;

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        subdirs.push(entry.name);
      }

      // Detect test directories
      if (TEST_DIR_NAMES.has(entry.name.toLowerCase())) {
        ctx.testDirs.push(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();

      // Track all relevant files
      if (ctx.extensionSet.size === 0 || ctx.extensionSet.has(ext)) {
        files.push(entry.name);
        ctx.allFiles.push({
          path: fullPath,
          relativePath: path.relative(rootPath, fullPath).replace(/\\/g, '/'),
          name: entry.name,
          ext
        });
      }

      // Detect index files
      if (INDEX_FILE_NAMES.has(entry.name.toLowerCase()) || entry.name.match(/^index\.(js|ts|jsx|tsx|py|go)$/i)) {
        hasIndex = true;
      }

      // Detect config files (only at root or near root)
      if (currentDepth <= 1 && CONFIG_FILE_PATTERNS.some(p => matchesPattern(entry.name, p))) {
        ctx.configFiles.push(fullPath);
      }
    }
  }

  // Create module entry for directories with source files (depth 1-2 only)
  const relPath = path.relative(rootPath, dirPath).replace(/\\/g, '/');
  if (currentDepth > 0 && currentDepth <= 2 && (files.length > 0 || subdirs.length > 0)) {
    ctx.modules.push({
      path: relPath || dirName,
      name: dirName,
      fileCount: files.length,
      submodules: subdirs.filter(s => !SKIP_DIRS.has(s)),
      hasIndex
    });
  }

  // Recurse into subdirectories
  for (const subdir of subdirs) {
    await scanDirectory(path.join(dirPath, subdir), rootPath, ctx, currentDepth + 1);
  }
}

/**
 * Detect the build tool from root-level config files
 */
async function detectBuildTool(rootPath) {
  const checks = [
    { file: 'forge.config.js', tool: 'electron-forge' },
    { file: 'forge.config.cjs', tool: 'electron-forge' },
    { file: 'webpack.config.js', tool: 'webpack' },
    { file: 'vite.config.js', tool: 'vite' },
    { file: 'vite.config.ts', tool: 'vite' },
    { file: 'rollup.config.js', tool: 'rollup' },
    { file: 'tsconfig.json', tool: 'typescript' },
    { file: 'Makefile', tool: 'make' },
    { file: 'CMakeLists.txt', tool: 'cmake' },
    { file: 'Cargo.toml', tool: 'cargo' },
    { file: 'go.mod', tool: 'go-modules' },
    { file: 'build.gradle', tool: 'gradle' },
    { file: 'pom.xml', tool: 'maven' },
    { file: 'setup.py', tool: 'setuptools' },
    { file: 'pyproject.toml', tool: 'python-build' },
    { file: 'package.json', tool: 'npm' }
  ];

  for (const { file, tool } of checks) {
    try {
      await fs.access(path.join(rootPath, file));
      return tool;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Detect entry points based on common patterns
 */
function detectEntryPoints(allFiles, rootPaths) {
  const entries = [];
  const entryPatterns = [
    /^src[/\\]main\.(js|ts|jsx|tsx)$/i,
    /^src[/\\]index\.(js|ts|jsx|tsx)$/i,
    /^src[/\\]app\.(js|ts|jsx|tsx)$/i,
    /^main\.(js|ts|py|go)$/i,
    /^index\.(js|ts)$/i,
    /^app\.(js|ts|py)$/i,
    /^Program\.(cs)$/i,
    /^cmd[/\\]main\.go$/i
  ];

  for (const file of allFiles) {
    for (const pattern of entryPatterns) {
      if (pattern.test(file.relativePath)) {
        entries.push(file.relativePath);
        break;
      }
    }
  }

  return entries;
}

/**
 * Compute language distribution
 */
function computeLanguageBreakdown(allFiles) {
  const counts = {};
  for (const file of allFiles) {
    const lang = EXT_TO_LANGUAGE[file.ext] || 'other';
    counts[lang] = (counts[lang] || 0) + 1;
  }

  // Sort by count descending
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const result = {};
  for (const [lang, count] of sorted) {
    result[lang] = count;
  }
  return result;
}

function matchesPattern(filename, pattern) {
  if (pattern instanceof RegExp) return pattern.test(filename);
  return filename.toLowerCase() === pattern.toLowerCase();
}

// ============================================
// Constants
// ============================================

const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.cache', 'coverage',
  'vendor', 'packages', '.tox', '.mypy_cache',
  '.idea', '.vscode', '.vs'
]);

const TEST_DIR_NAMES = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs',
  'test_utils', 'testing', 'e2e', 'integration'
]);

const INDEX_FILE_NAMES = new Set([
  'index.js', 'index.ts', 'index.jsx', 'index.tsx',
  'index.py', '__init__.py', 'mod.rs', 'lib.rs'
]);

const CONFIG_FILE_PATTERNS = [
  'package.json', 'tsconfig.json', '.env', '.env.example',
  'webpack.config.js', 'webpack.main.config.js', 'webpack.renderer.config.js',
  'vite.config.js', 'vite.config.ts',
  'forge.config.js', 'forge.config.cjs',
  '.eslintrc.js', '.eslintrc.json', '.prettierrc',
  'jest.config.js', 'jest.config.ts',
  'Dockerfile', 'docker-compose.yml',
  'Makefile', 'CMakeLists.txt',
  'Cargo.toml', 'go.mod', 'go.sum',
  'requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg',
  'pom.xml', 'build.gradle',
  '.gitignore', '.dockerignore',
  /\.csproj$/i
];

const EXT_TO_LANGUAGE = {
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.cs': 'csharp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
  '.c': 'c', '.h': 'c',
  '.sh': 'bash', '.bash': 'bash',
  '.md': 'markdown',
  '.json': 'json',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.sql': 'sql',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.scala': 'scala',
  '.lua': 'lua'
};

module.exports = {
  analyzeDirectoryStructure
};
