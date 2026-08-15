// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    // research | algorithm | tech | daily — 决定文章归入哪个分类页
    category: z.enum(['research', 'algorithm', 'tech', 'daily']).default('tech'),
    // 分类页置顶；当前仅由 Research 列表使用
    pinned: z.boolean().optional().default(false),
    // 可选封面图，卡片右侧作为背景铺开
    cover: z.string().optional(),
    // 文末参考文献卡片；不写序号，顺序即列表顺序
    references: z
      .array(
        z.object({
          title: z.string(),
          meta: z.string().optional(),
          url: z.string().optional(),
        })
      )
      .optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};
