const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

// Read PROD_BUILD from environment at build time
const IS_PROD_BUILD = process.env.PROD_BUILD === 'true';
console.log(`[Webpack Main] Building in ${IS_PROD_BUILD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

/**
 * Plugin that copies pdfjs-dist worker file to webpack output directory.
 * pdfjs-dist's legacy build uses a fake worker that does import('./pdf.worker.mjs')
 * at runtime, so the worker file must be alongside the bundled chunk.
 */
class CopyPdfWorkerPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync('CopyPdfWorkerPlugin', (compilation, callback) => {
      const workerSrc = path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
      const outputPath = compilation.outputOptions.path;
      const workerDest = path.join(outputPath, 'pdf.worker.mjs');

      if (!fs.existsSync(workerSrc)) {
        console.warn('[CopyPdfWorkerPlugin] pdf.worker.mjs not found, skipping copy');
        return callback();
      }

      fs.copyFile(workerSrc, workerDest, (err) => {
        if (err) {
          console.warn('[CopyPdfWorkerPlugin] Failed to copy pdf.worker.mjs:', err.message);
        }
        callback();
      });
    });
  }
}

module.exports = {
  entry: './src/main.js',
  module: {
    rules: require('./webpack.rules'),
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
  externals: ({ request }, callback) => {
    // @lancedb/* packages contain native NAPI modules — can't be bundled.
    // apache-arrow must also be external so that lancedb's JS wrapper and
    // our vectorStore.js share the same module instance (otherwise instanceof
    // checks across the two copies fail and LanceDB's Rust code panics on
    // the malformed Arrow IPC buffer).
    if (/^@lancedb\//.test(request) || request === 'apache-arrow' || request === 'ffmpeg-static') {
      return callback(null, `commonjs ${request}`);
    }
    callback();
  },
  plugins: [
    new CopyPdfWorkerPlugin(),
    // Inject PROD_BUILD constant at build time
    new webpack.DefinePlugin({
      'process.env.PROD_BUILD': JSON.stringify(IS_PROD_BUILD ? 'true' : 'false'),
    }),
  ],
};
