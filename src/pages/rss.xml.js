// Copyright (c) 2026 AcmeX. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.


import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = await getCollection('blog');
  return rss({
    title: 'AcmeX的技术博客',
    description: '机器人视觉算法 / ROS2系统开发',
    site: context.site,
    items: posts.map(post => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      description: post.data.description || '',
      link: `/blog/${post.id.replace(/\.md$/, '')}`,
    })),
    customData: `<language>zh-CN</language>`,
  });
}
