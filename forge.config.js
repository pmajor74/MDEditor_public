const path = require('path');
const fs = require('fs');

/**
 * Returns the @lancedb platform-specific native package name for the given platform/arch.
 */
function getLanceDbNativePackage(platform, arch) {
  const map = {
    'win32-x64': '@lancedb/lancedb-win32-x64-msvc',
    'win32-arm64': '@lancedb/lancedb-win32-arm64-msvc',
    'darwin-x64': '@lancedb/lancedb-darwin-x64',
    'darwin-arm64': '@lancedb/lancedb-darwin-arm64',
    'linux-x64': '@lancedb/lancedb-linux-x64-gnu',
    'linux-arm64': '@lancedb/lancedb-linux-arm64-gnu',
  };
  return map[`${platform}-${arch}`] || null;
}

/**
 * Recursively collects all runtime dependencies for a list of root packages.
 * Reads each package's package.json to find dependencies and peerDependencies,
 * then recurses. Returns a Set of package names to copy.
 * Skips @types/* packages (TypeScript-only, not needed at runtime).
 */
function collectDeps(rootPackages, nodeModulesDir) {
  const visited = new Set();
  const queue = [...rootPackages];

  while (queue.length > 0) {
    const pkg = queue.shift();
    if (visited.has(pkg)) continue;
    // Skip @types packages — not needed at runtime
    if (pkg.startsWith('@types/')) continue;

    const pkgDir = path.join(nodeModulesDir, ...pkg.split('/'));
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;

    visited.add(pkg);

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    const deps = Object.keys(pkgJson.dependencies || {});
    const peerDeps = Object.keys(pkgJson.peerDependencies || {});
    for (const dep of [...deps, ...peerDeps]) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return visited;
}

module.exports = {
  packagerConfig: {
    name: 'AzureWikiEdit',
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    // Squirrel maker for setup.exe installer (uncomment when ready):
    // {
    //   name: '@electron-forge/maker-squirrel',
    //   config: {
    //     name: 'AzureWikiEdit',
    //     setupExe: 'AzureWikiEdit-Setup.exe',
    //     // icon: './assets/icon.ico',  // Add an icon file when available
    //   },
    // },
  ],
  hooks: {
    /**
     * Copy webpack-external native packages (and all their transitive deps)
     * into the build directory so they end up inside the ASAR.
     *
     * Without this, require('@lancedb/lancedb') fails in the packaged app
     * because webpack externals emit a bare require() but node_modules is
     * not included in the ASAR by default.
     */
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const projectRoot = path.resolve(__dirname);
      const nodeModulesDir = path.join(projectRoot, 'node_modules');
      const nativePkg = getLanceDbNativePackage(platform, arch);

      // Root packages that webpack externalizes
      const rootExternals = ['@lancedb/lancedb'];
      if (nativePkg) rootExternals.push(nativePkg);

      // Recursively collect all runtime deps
      const allPackages = collectDeps(rootExternals, nodeModulesDir);
      console.log(`[forge hook] Resolved ${allPackages.size} packages to copy for webpack externals`);

      for (const pkg of allPackages) {
        const src = path.join(nodeModulesDir, ...pkg.split('/'));
        const dest = path.join(buildPath, 'node_modules', ...pkg.split('/'));

        if (!fs.existsSync(src)) {
          console.warn(`[forge hook] WARNING: ${pkg} not found at ${src}`);
          continue;
        }

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        console.log(`[forge hook] Copied ${pkg}`);
      }
    },
  },
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        // Disable the error overlay for runtime errors (ProseMirror throws non-fatal errors)
        devServer: {
          client: {
            overlay: {
              errors: false,
              warnings: false,
              runtimeErrors: false,
            },
          },
        },
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/index.html',
              js: './src/renderer.js',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
  ],
};
