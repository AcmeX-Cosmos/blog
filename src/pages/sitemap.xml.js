// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


import { getCollection } from 'astro:content';

export async function GET() {
  const posts = await getCollection('blog');

  // Map from slug to full path with tag context for determining which tag page it belongs to
  const postEntries = posts.map(post => {
    const slug = post.id.replace(/\.md$/, '');
    return {
      url: `/blog/${slug}`,
      lastmod: post.data.date,
    };
  });

  const allTags = [...new Set(posts.flatMap(p => p.data.tags || []))];
  const tagEntries = allTags.map(tag => ({
    url: `/blog/tag/${encodeURIComponent(tag)}`,
    lastmod: posts
      .filter(p => (p.data.tags || []).includes(tag))
      .map(p => p.data.date)
      .sort()
      .reverse()[0],
  }));

  const entries = [
    { url: '/', lastmod: posts[0]?.data.date || '' },
    { url: '/projects', lastmod: '' },
    { url: '/about', lastmod: '' },
    ...postEntries,
    ...tagEntries,
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>https://chenzexin.github.io/blog${e.url}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>`;

  return new Response(sitemap, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
