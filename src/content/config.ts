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
    // 可选封面图，卡片右侧作为背景铺开
    cover: z.string().optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};
