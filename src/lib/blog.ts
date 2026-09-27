import { getCollection, type CollectionEntry } from 'astro:content';

/** Normalize content-layer (`1`) and legacy (`1.md` / `blog/1`) ids to the bare slug. */
export function postSlug(post: Pick<CollectionEntry<'blog'>, 'id' | 'slug'>): string {
	const raw = 'slug' in post && post.slug ? post.slug : post.id;
	return String(raw)
		.replace(/^blog\//, '')
		.replace(/\.(md|mdx)$/, '');
}

export async function getPublishedBlogPosts(): Promise<CollectionEntry<'blog'>[]> {
	const posts = await getCollection('blog');
	return posts
		.filter((post) => post.data.published === true)
		.sort((a, b) => new Date(b.data.pubDate).valueOf() - new Date(a.data.pubDate).valueOf());
}
