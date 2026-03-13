/**
 * Manifest Parser
 * Parses project manifest files (package.json, requirements.txt, etc.)
 * and extracts structured metadata for enhanced indexing
 */

const fs = require('fs').promises;
const path = require('path');

// Supported manifest types
const MANIFEST_TYPES = {
  PACKAGE_JSON: 'package.json',
  REQUIREMENTS_TXT: 'requirements.txt',
  PYPROJECT_TOML: 'pyproject.toml',
  CSPROJ: '.csproj',
  PACKAGES_CONFIG: 'packages.config',
  GO_MOD: 'go.mod',
  CARGO_TOML: 'Cargo.toml',
  COMPOSER_JSON: 'composer.json',
  GEMFILE: 'Gemfile',
  POM_XML: 'pom.xml'
};

/**
 * Find all manifest files in given paths
 * @param {string[]} rootPaths - Root paths to search
 * @returns {Promise<Array>} Array of manifest info objects
 */
async function findManifests(rootPaths) {
  const manifests = [];

  for (const rootPath of rootPaths) {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const fileName = entry.name;
        const filePath = path.join(rootPath, fileName);

        // Check for known manifest files
        if (fileName === MANIFEST_TYPES.PACKAGE_JSON) {
          manifests.push({ type: 'nodejs', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.REQUIREMENTS_TXT) {
          manifests.push({ type: 'python', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.PYPROJECT_TOML) {
          manifests.push({ type: 'python', filePath, fileName });
        } else if (fileName.endsWith('.csproj')) {
          manifests.push({ type: 'dotnet', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.PACKAGES_CONFIG) {
          manifests.push({ type: 'dotnet', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.GO_MOD) {
          manifests.push({ type: 'go', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.CARGO_TOML) {
          manifests.push({ type: 'rust', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.COMPOSER_JSON) {
          manifests.push({ type: 'php', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.GEMFILE) {
          manifests.push({ type: 'ruby', filePath, fileName });
        } else if (fileName === MANIFEST_TYPES.POM_XML) {
          manifests.push({ type: 'java', filePath, fileName });
        }
      }
    } catch (error) {
      console.error(`[Manifest Parser] Error scanning ${rootPath}:`, error.message);
    }
  }

  return manifests;
}

/**
 * Parse a manifest file and extract structured data
 * @param {Object} manifest - Manifest info object
 * @returns {Promise<Object>} Parsed manifest data
 */
async function parseManifest(manifest) {
  try {
    const content = await fs.readFile(manifest.filePath, 'utf-8');

    switch (manifest.type) {
      case 'nodejs':
        return parsePackageJson(content, manifest.filePath);
      case 'python':
        if (manifest.fileName === 'requirements.txt') {
          return parseRequirementsTxt(content, manifest.filePath);
        } else {
          return parsePyprojectToml(content, manifest.filePath);
        }
      case 'dotnet':
        if (manifest.fileName.endsWith('.csproj')) {
          return parseCsproj(content, manifest.filePath);
        } else {
          return parsePackagesConfig(content, manifest.filePath);
        }
      case 'go':
        return parseGoMod(content, manifest.filePath);
      case 'rust':
        return parseCargoToml(content, manifest.filePath);
      case 'php':
        return parseComposerJson(content, manifest.filePath);
      case 'ruby':
        return parseGemfile(content, manifest.filePath);
      case 'java':
        return parsePomXml(content, manifest.filePath);
      default:
        return null;
    }
  } catch (error) {
    console.error(`[Manifest Parser] Error parsing ${manifest.filePath}:`, error.message);
    return null;
  }
}

/**
 * Parse package.json
 */
function parsePackageJson(content, filePath) {
  try {
    const pkg = JSON.parse(content);

    const dependencies = Object.keys(pkg.dependencies || {});
    const devDependencies = Object.keys(pkg.devDependencies || {});
    const scripts = Object.keys(pkg.scripts || {});

    // Detect tech stack from dependencies
    const techStack = detectTechStackFromNpm(dependencies, devDependencies);

    return {
      type: 'manifest',
      manifestType: 'package.json',
      filePath,
      projectName: pkg.name || 'Unknown',
      description: pkg.description || '',
      version: pkg.version || '',
      techStack,
      dependencies: dependencies.slice(0, 50), // Limit for embedding
      devDependencies: devDependencies.slice(0, 30),
      scripts,
      raw: formatManifestChunk({
        name: pkg.name,
        description: pkg.description,
        techStack,
        dependencies: dependencies.slice(0, 30),
        devDependencies: devDependencies.slice(0, 20),
        scripts
      })
    };
  } catch (error) {
    return null;
  }
}

/**
 * Parse requirements.txt
 */
function parseRequirementsTxt(content, filePath) {
  const lines = content.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const packages = lines.map(l => {
    const match = l.match(/^([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }).filter(Boolean);

  const techStack = detectTechStackFromPython(packages);

  return {
    type: 'manifest',
    manifestType: 'requirements.txt',
    filePath,
    projectName: path.basename(path.dirname(filePath)),
    techStack,
    dependencies: packages.slice(0, 50),
    raw: formatManifestChunk({
      name: path.basename(path.dirname(filePath)),
      techStack,
      pythonPackages: packages.slice(0, 40)
    })
  };
}

/**
 * Parse pyproject.toml (basic parsing)
 */
function parsePyprojectToml(content, filePath) {
  const projectName = extractTomlValue(content, 'name') || path.basename(path.dirname(filePath));
  const description = extractTomlValue(content, 'description') || '';

  // Extract dependencies from [project.dependencies] or [tool.poetry.dependencies]
  const deps = [];
  const depsMatch = content.match(/\[(?:project\.)?dependencies\]([\s\S]*?)(?:\[|$)/);
  if (depsMatch) {
    const depsSection = depsMatch[1];
    const pkgMatches = depsSection.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
    for (const match of pkgMatches) {
      deps.push(match[1]);
    }
  }

  const techStack = detectTechStackFromPython(deps);

  return {
    type: 'manifest',
    manifestType: 'pyproject.toml',
    filePath,
    projectName,
    description,
    techStack,
    dependencies: deps.slice(0, 50),
    raw: formatManifestChunk({
      name: projectName,
      description,
      techStack,
      pythonPackages: deps.slice(0, 40)
    })
  };
}

/**
 * Parse .csproj file
 */
function parseCsproj(content, filePath) {
  const projectName = path.basename(filePath, '.csproj');

  // Extract PackageReferences
  const packages = [];
  const pkgMatches = content.matchAll(/<PackageReference\s+Include="([^"]+)"/g);
  for (const match of pkgMatches) {
    packages.push(match[1]);
  }

  // Extract TargetFramework
  const frameworkMatch = content.match(/<TargetFramework>([^<]+)<\/TargetFramework>/);
  const framework = frameworkMatch ? frameworkMatch[1] : '';

  const techStack = ['dotnet'];
  if (framework.includes('net6') || framework.includes('net7') || framework.includes('net8')) {
    techStack.push('.NET Core');
  }
  if (packages.some(p => p.toLowerCase().includes('aspnet'))) {
    techStack.push('ASP.NET');
  }
  if (packages.some(p => p.toLowerCase().includes('entityframework'))) {
    techStack.push('Entity Framework');
  }

  return {
    type: 'manifest',
    manifestType: '.csproj',
    filePath,
    projectName,
    techStack,
    framework,
    dependencies: packages.slice(0, 50),
    raw: formatManifestChunk({
      name: projectName,
      framework,
      techStack,
      nugetPackages: packages.slice(0, 40)
    })
  };
}

/**
 * Parse packages.config (legacy .NET)
 */
function parsePackagesConfig(content, filePath) {
  const packages = [];
  const pkgMatches = content.matchAll(/<package\s+id="([^"]+)"/g);
  for (const match of pkgMatches) {
    packages.push(match[1]);
  }

  return {
    type: 'manifest',
    manifestType: 'packages.config',
    filePath,
    projectName: path.basename(path.dirname(filePath)),
    techStack: ['dotnet', '.NET Framework'],
    dependencies: packages.slice(0, 50),
    raw: formatManifestChunk({
      name: path.basename(path.dirname(filePath)),
      techStack: ['dotnet', '.NET Framework'],
      nugetPackages: packages.slice(0, 40)
    })
  };
}

/**
 * Parse go.mod
 */
function parseGoMod(content, filePath) {
  // Extract module name
  const moduleMatch = content.match(/module\s+([^\s]+)/);
  const moduleName = moduleMatch ? moduleMatch[1] : path.basename(path.dirname(filePath));

  // Extract require statements
  const deps = [];
  const requireMatch = content.match(/require\s*\(([\s\S]*?)\)/);
  if (requireMatch) {
    const requireSection = requireMatch[1];
    const depMatches = requireSection.matchAll(/^\s*([^\s]+)\s+/gm);
    for (const match of depMatches) {
      deps.push(match[1]);
    }
  }

  return {
    type: 'manifest',
    manifestType: 'go.mod',
    filePath,
    projectName: moduleName,
    techStack: ['go'],
    dependencies: deps.slice(0, 50),
    raw: formatManifestChunk({
      name: moduleName,
      techStack: ['go'],
      goModules: deps.slice(0, 40)
    })
  };
}

/**
 * Parse Cargo.toml
 */
function parseCargoToml(content, filePath) {
  const name = extractTomlValue(content, 'name') || path.basename(path.dirname(filePath));
  const description = extractTomlValue(content, 'description') || '';

  // Extract dependencies
  const deps = [];
  const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
  if (depsMatch) {
    const depsSection = depsMatch[1];
    const pkgMatches = depsSection.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
    for (const match of pkgMatches) {
      deps.push(match[1]);
    }
  }

  return {
    type: 'manifest',
    manifestType: 'Cargo.toml',
    filePath,
    projectName: name,
    description,
    techStack: ['rust'],
    dependencies: deps.slice(0, 50),
    raw: formatManifestChunk({
      name,
      description,
      techStack: ['rust'],
      rustCrates: deps.slice(0, 40)
    })
  };
}

/**
 * Parse composer.json
 */
function parseComposerJson(content, filePath) {
  try {
    const pkg = JSON.parse(content);
    const deps = Object.keys(pkg.require || {}).filter(d => !d.startsWith('php'));
    const devDeps = Object.keys(pkg['require-dev'] || {});

    const techStack = ['php'];
    if (deps.some(d => d.includes('laravel'))) techStack.push('Laravel');
    if (deps.some(d => d.includes('symfony'))) techStack.push('Symfony');

    return {
      type: 'manifest',
      manifestType: 'composer.json',
      filePath,
      projectName: pkg.name || path.basename(path.dirname(filePath)),
      description: pkg.description || '',
      techStack,
      dependencies: deps.slice(0, 50),
      raw: formatManifestChunk({
        name: pkg.name,
        description: pkg.description,
        techStack,
        phpPackages: deps.slice(0, 40)
      })
    };
  } catch {
    return null;
  }
}

/**
 * Parse Gemfile (basic)
 */
function parseGemfile(content, filePath) {
  const gems = [];
  const gemMatches = content.matchAll(/gem\s+['"]([^'"]+)['"]/g);
  for (const match of gemMatches) {
    gems.push(match[1]);
  }

  const techStack = ['ruby'];
  if (gems.includes('rails')) techStack.push('Rails');
  if (gems.includes('sinatra')) techStack.push('Sinatra');

  return {
    type: 'manifest',
    manifestType: 'Gemfile',
    filePath,
    projectName: path.basename(path.dirname(filePath)),
    techStack,
    dependencies: gems.slice(0, 50),
    raw: formatManifestChunk({
      name: path.basename(path.dirname(filePath)),
      techStack,
      rubyGems: gems.slice(0, 40)
    })
  };
}

/**
 * Parse pom.xml (basic)
 */
function parsePomXml(content, filePath) {
  // Extract artifactId
  const artifactMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
  const name = artifactMatch ? artifactMatch[1] : path.basename(path.dirname(filePath));

  // Extract dependencies
  const deps = [];
  const depMatches = content.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g);
  for (const match of depMatches) {
    deps.push(`${match[1]}:${match[2]}`);
  }

  const techStack = ['java'];
  if (deps.some(d => d.includes('spring'))) techStack.push('Spring');
  if (deps.some(d => d.includes('hibernate'))) techStack.push('Hibernate');

  return {
    type: 'manifest',
    manifestType: 'pom.xml',
    filePath,
    projectName: name,
    techStack,
    dependencies: deps.slice(0, 50),
    raw: formatManifestChunk({
      name,
      techStack,
      mavenDeps: deps.slice(0, 40)
    })
  };
}

/**
 * Extract simple value from TOML
 */
function extractTomlValue(content, key) {
  const match = content.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`));
  return match ? match[1] : null;
}

/**
 * Detect tech stack from npm packages
 */
function detectTechStackFromNpm(deps, devDeps) {
  const allDeps = [...deps, ...devDeps];
  const stack = ['nodejs'];

  if (allDeps.includes('react') || allDeps.includes('react-dom')) stack.push('React');
  if (allDeps.includes('vue')) stack.push('Vue');
  if (allDeps.includes('@angular/core')) stack.push('Angular');
  if (allDeps.includes('svelte')) stack.push('Svelte');
  if (allDeps.includes('next')) stack.push('Next.js');
  if (allDeps.includes('nuxt')) stack.push('Nuxt');
  if (allDeps.includes('express')) stack.push('Express');
  if (allDeps.includes('fastify')) stack.push('Fastify');
  if (allDeps.includes('electron')) stack.push('Electron');
  if (allDeps.includes('typescript')) stack.push('TypeScript');
  if (allDeps.includes('tailwindcss')) stack.push('Tailwind');
  if (allDeps.includes('prisma')) stack.push('Prisma');
  if (allDeps.includes('mongoose')) stack.push('MongoDB');
  if (allDeps.includes('pg')) stack.push('PostgreSQL');

  return stack;
}

/**
 * Detect tech stack from Python packages
 */
function detectTechStackFromPython(packages) {
  const stack = ['python'];

  if (packages.includes('django')) stack.push('Django');
  if (packages.includes('flask')) stack.push('Flask');
  if (packages.includes('fastapi')) stack.push('FastAPI');
  if (packages.includes('pandas')) stack.push('Pandas');
  if (packages.includes('numpy')) stack.push('NumPy');
  if (packages.includes('tensorflow') || packages.includes('tf')) stack.push('TensorFlow');
  if (packages.includes('torch') || packages.includes('pytorch')) stack.push('PyTorch');
  if (packages.includes('scikit-learn') || packages.includes('sklearn')) stack.push('scikit-learn');
  if (packages.includes('sqlalchemy')) stack.push('SQLAlchemy');

  return stack;
}

/**
 * Format manifest data as indexable chunk
 */
function formatManifestChunk(data) {
  const lines = [];
  lines.push(`Project: ${data.name || 'Unknown'}`);

  if (data.description) {
    lines.push(`Description: ${data.description}`);
  }

  if (data.techStack && data.techStack.length > 0) {
    lines.push(`Tech Stack: ${data.techStack.join(', ')}`);
  }

  if (data.framework) {
    lines.push(`Framework: ${data.framework}`);
  }

  // Add dependencies section based on type
  const depTypes = ['dependencies', 'devDependencies', 'pythonPackages', 'nugetPackages',
    'goModules', 'rustCrates', 'phpPackages', 'rubyGems', 'mavenDeps'];

  for (const depType of depTypes) {
    if (data[depType] && data[depType].length > 0) {
      const label = formatDepLabel(depType);
      lines.push(`${label}: ${data[depType].join(', ')}`);
    }
  }

  if (data.scripts && data.scripts.length > 0) {
    lines.push(`Available Scripts: ${data.scripts.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format dependency label
 */
function formatDepLabel(type) {
  const labels = {
    dependencies: 'Dependencies',
    devDependencies: 'Dev Dependencies',
    pythonPackages: 'Python Packages',
    nugetPackages: 'NuGet Packages',
    goModules: 'Go Modules',
    rustCrates: 'Rust Crates',
    phpPackages: 'PHP Packages',
    rubyGems: 'Ruby Gems',
    mavenDeps: 'Maven Dependencies'
  };
  return labels[type] || type;
}

/**
 * Create manifest chunks for indexing
 * @param {string[]} rootPaths - Root paths to search
 * @returns {Promise<Array>} Array of chunk objects ready for indexing
 */
async function createManifestChunks(rootPaths) {
  const manifests = await findManifests(rootPaths);
  const chunks = [];

  for (const manifest of manifests) {
    const parsed = await parseManifest(manifest);
    if (!parsed || !parsed.raw) continue;

    chunks.push({
      id: `manifest_${path.basename(manifest.filePath).replace(/[^a-zA-Z0-9]/g, '_')}`,
      content: parsed.raw,
      metadata: {
        structureType: 'manifest',
        fileType: 'config',
        fileName: manifest.fileName,
        filePath: manifest.filePath,
        manifestType: parsed.manifestType,
        techStack: parsed.techStack || [],
        projectName: parsed.projectName || ''
      }
    });
  }

  return chunks;
}

module.exports = {
  findManifests,
  parseManifest,
  createManifestChunks,
  MANIFEST_TYPES
};
