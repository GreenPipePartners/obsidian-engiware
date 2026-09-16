import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores(['node_modules/**', 'dist/**', 'examples/**', 'scripts/**', 'tests/**']),
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['Engiware', 'Engibook', 'Engispark', 'EngiLib', 'Ignition Designer', 'Ignition', 'Perspective', 'WebGL', 'Image', 'Esc'],
        acronyms: ['3D', 'GLB', 'PDF', 'DC', 'OK', 'ZIP', 'SHA-256'],
        ignoreRegex: ['^Import \\.engibook$'],
        enforceCamelCaseLower: true,
      }],
    },
  },
  {
    // Shared native-view renderer also runs without Obsidian's DOM extensions.
    files: ['src/perspective-renderer.ts'],
    rules: { 'obsidianmd/prefer-create-el': 'off' },
  },
);
