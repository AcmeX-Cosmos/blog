// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


import type { CollectionEntry } from 'astro:content';
import { categories } from '../data/categories';

/** 每个分类页显示的文章数，超出走分页 */
export const PAGE_SIZE = 10;

export interface TagCount {
  name: string;
  count: number;
}

/** 判断标签是否包含中文字符，用于英文关键词索引。 */
export function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text);
}

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

/** 按文章覆盖量降序返回标签统计；同频标签按名称稳定排序。 */
export function countTags(posts: CollectionEntry<'blog'>[]): TagCount[] {
  const counts = new Map<string, number>();

  for (const post of posts) {
    for (const tag of new Set(post.data.tags || [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
