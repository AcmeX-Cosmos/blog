import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const queryCompat = fileURLToPath(new URL('./src/shims/astro-query-compat.mjs', import.meta.url));

export default defineConfig({
  site: 'https://acmex-cosmos.github.io',
  base: '/',
  trailingSlash: 'never',
  build: {
    assets: 'assets'
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        'aria-query': queryCompat,
        'axobject-query': queryCompat
      }
    }
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [[rehypeKatex, { output: 'html' }]],
    shikiConfig: {
      theme: 'github-dark',
      wrap: true
    }
  }
});
