// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


// 分类元数据 — 顺序决定分类页之间前后箭头的切换环
export interface Category {
  slug: 'research' | 'algorithm' | 'tech' | 'daily';
  title: string;
  label: string;
  description: string;
}

export const categories: Category[] = [
  {
    slug: 'research',
    title: 'Research',
    label: '论文研究',
    description: '论文阅读、公式推导与文献复现笔记。',
  },
  {
    slug: 'algorithm',
    title: 'Algorithm',
    label: '算法实现',
    description: '算法从零实现、调参与工程落地。',
  },
  {
    slug: 'tech',
    title: 'Technical',
    label: '工程与技术实践',
    description: '机器人视觉、ROS2 开发与工程实践。',
  },
  {
    slug: 'daily',
    title: 'Daily Life',
    label: '日常记录',
    description: '随笔、折腾记录与生活碎片。',
  },
];

export function getCategory(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

/** 环形取相邻分类，用于标题旁的上一个 / 下一个箭头 */
export function getNeighbors(slug: string) {
  const i = categories.findIndex((c) => c.slug === slug);
  if (i === -1) return { prev: undefined, next: undefined };
  return {
    prev: categories[(i - 1 + categories.length) % categories.length],
    next: categories[(i + 1) % categories.length],
  };
}
