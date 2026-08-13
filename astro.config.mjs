import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://acmex-cosmos.github.io',
  base: '/blog',
  trailingSlash: 'never',
  build: {
    assets: 'assets'
  },
  vite: {
    plugins: [tailwindcss()]
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
