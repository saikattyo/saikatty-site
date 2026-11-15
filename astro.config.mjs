// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { createStudioLocalVitePlugin } from './src/lib/studioLocalFs.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
	site: 'https://saikattyo.com',
	integrations: [
		mdx(),
		sitemap({
			filter: (page) => !page.includes('/studio'),
		}),
	],
	legacy: {
		collections: true,
	},
	vite: {
		plugins: [createStudioLocalVitePlugin(__dirname)],
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
						if (
							id.includes('node_modules/@codemirror') ||
							id.includes('node_modules/codemirror') ||
							id.includes('node_modules/@lezer')
						) {
							return 'codemirror-studio';
						}
					},
				},
			},
			chunkSizeWarningLimit: 600,
		},
	},
});
