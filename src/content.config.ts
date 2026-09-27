import { defineCollection, z } from 'astro:content';

// Legacy content collections (import.meta.glob) avoid Astro 5.1 content-layer
// data-store races where an empty `.astro/data-store.json` leaves getCollection() stuck empty in `astro dev`.
const blog = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		published: z.boolean().default(true),
	}),
});

export const collections = { blog };
