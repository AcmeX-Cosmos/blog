// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


import type { CollectionEntry } from 'astro:content';
import { categories } from '../data/categories';

/** 每个分类页显示的文章数，超出走分页 */
export const PAGE_SIZE = 15;

export function sortedPosts(posts: CollectionEntry<'blog'>[]) {
  return [...posts].sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );
}

export function countByCategory(posts: CollectionEntry<'blog'>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cat of categories) counts[cat.slug] = 0;
  for (const p of posts) {
    counts[p.data.category] = (counts[p.data.category] ?? 0) + 1;
  }
  return counts;
}
