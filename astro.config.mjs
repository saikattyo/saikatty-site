// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://example.com',
	integrations: [mdx(), sitemap()],
	// Use legacy content collections so getCollection() does not depend on
	// `.astro/data-store.json`, which can be left empty by content-layer write races in Astro 5.1.
	legacy: {
		collections: true,
	},
});
