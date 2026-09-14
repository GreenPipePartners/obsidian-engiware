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
        brands: ['Engiware', 'Engibook', 'WebGL', 'Image', 'Esc'],
        acronyms: ['3D', 'GLB', 'PDF'],
        ignoreRegex: ['^Import \\.engibook$'],
        enforceCamelCaseLower: true,
      }],
      // Declarative settings require Obsidian 1.13; retain the public 1.8.7 API.
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    },
  },
);
