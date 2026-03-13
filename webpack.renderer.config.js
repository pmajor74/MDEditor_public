// Renderer-specific webpack config - DO NOT use webpack.rules.js (it has Node.js loaders)
const webpack = require('webpack');

// Read PROD_BUILD from environment at build time
const IS_PROD_BUILD = process.env.PROD_BUILD === 'true';
console.log(`[Webpack Renderer] Building in ${IS_PROD_BUILD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

module.exports = {
  module: {
    rules: [
      // CSS loader for stylesheets
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      // Asset loader for images/fonts
      {
        test: /\.(png|jpg|jpeg|gif|svg|woff|woff2|eot|ttf|otf)$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.css'],
    // Force webpack to use CommonJS exports (require condition) instead of ESM (import condition)
    // This fixes "Class constructor Selection cannot be invoked without 'new'" error
    // because the CommonJS build is pre-transpiled while ESM uses native ES6 classes
    conditionNames: ['require', 'node', 'default'],
  },
  plugins: [
    // Inject PROD_BUILD constant at build time
    new webpack.DefinePlugin({
      'process.env.PROD_BUILD': JSON.stringify(IS_PROD_BUILD ? 'true' : 'false'),
    }),
  ],
  // NOTE: splitChunks is NOT compatible with @electron-forge/plugin-webpack.
  // Forge's HtmlWebpackPlugin sets chunks: [entryPoint.name], so split vendor
  // chunks would be created but never loaded. Keep everything in one bundle.
};
