// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://saikattyo.com',
	integrations: [mdx(), sitemap()],
	legacy: {
		collections: true,
	},
	vite: {
		build: {
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (id.includes('node_modules/three/examples')) {
							return 'three-addons';
						}
						if (id.includes('node_modules/three')) {
							return 'three-core';
						}
					},
				},
			},
			chunkSizeWarningLimit: 600,
		},
	},
});
