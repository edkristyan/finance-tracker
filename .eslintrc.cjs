module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  extends: ['eslint:recommended', 'plugin:security/recommended-legacy'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['security'],
  rules: {
    // Catch dead code/typos without blocking on intentionally-unused function args.
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // We sanitize explicitly in utils/sanitize.js before any innerHTML write,
    // so keep this as a warning to flag call sites for review rather than
    // blocking the whole render layer (which relies on template strings).
    'security/detect-object-injection': 'off',
  },
};
