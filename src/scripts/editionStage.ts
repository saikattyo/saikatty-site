import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

interface EditionSpec {
	code: string;
	name: string;
	file: string;
	accentRim: number;
	initialTilt: [number, number, number];
	scale: number;
}

const EDITIONS: EditionSpec[] = [
	{
		code: '01 / 04',
		name: 'NANO DISPERSION',
		file: '/models/edition-01-nano.glb',
		accentRim: 0x2dd4bf,
		initialTilt: [0.22, -0.45, 0.08],
		scale: 1.02,
	},
	{
		code: '02 / 04',
		name: 'CHROME KINOKO',
		file: '/models/edition-02-kinoko.glb',
		accentRim: 0xf43f5e,
		initialTilt: [0.1, -0.22, -0.04],
		scale: 1.08,
	},
	{
		code: '03 / 04',
		name: 'LIQUID MERCURY',
		file: '/models/edition-03-melt.glb',
		accentRim: 0x60a5fa,
		initialTilt: [0.25, 0.35, -0.12],
		scale: 1.05,
	},
	{
		code: '04 / 04',
		name: 'SILICON ACOUSTICS',
		file: '/models/edition-04-wafer.glb',
		accentRim: 0x818cf8,
		initialTilt: [0.28, -0.42, 0.16],
		scale: 1.04,
	},
];

const STORAGE_KEY = 'saikattyo_edition_cursor';

function pickVisitEdition(): EditionSpec {
	try {
		const params = new URLSearchParams(window.location.search);
		const forced = Number(params.get('edition'));
		if (forced >= 1 && forced <= EDITIONS.length) {
			return EDITIONS[forced - 1];
		}

		const raw = window.localStorage.getItem(STORAGE_KEY);
		const nextIdx = raw === null ? 0 : (Number.parseInt(raw, 10) + 1) % EDITIONS.length;
		const safeIdx = Number.isNaN(nextIdx) ? 0 : nextIdx;
		window.localStorage.setItem(STORAGE_KEY, String(safeIdx));
		return EDITIONS[safeIdx];
	} catch {
		return EDITIONS[Math.floor(Math.random() * EDITIONS.length)];
	}
}

function createDeepSpaceDust(): THREE.Points {
	const count = 900;
	const positions = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) {
		const r = 4.5 + Math.random() * 18;
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
		positions[i * 3 + 2] = r * Math.cos(phi) - 3.5;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	const mat = new THREE.PointsMaterial({
		color: 0xdbeafe,
		size: 0.028,
		transparent: true,
		opacity: 0.48,
		sizeAttenuation: true,
		depthWrite: false,
	});
	return new THREE.Points(geo, mat);
}

export function initEditionStage(root: HTMLElement): () => void {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-edition-canvas]');
	if (!canvas) return () => {};

	const variant = (root.dataset.variant || 'home') as 'home' | 'compact';
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const edition = pickVisitEdition();

	// Update minimal quiet corner stamp if present
	document.querySelectorAll<HTMLElement>('[data-edition-stamp]').forEach((el) => {
		el.textContent = `${edition.code} — ${edition.name}`;
	});

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: false,
			powerPreference: 'high-performance',
		});
	} catch {
		return () => {};
	}

	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	renderer.setPixelRatio(dpr);
	renderer.setClearColor(0x000000, 1);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.16;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x000000);

	const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
	camera.position.set(0, 0.05, 6.9);

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 768), 0.18, 0.45, 0.94);
	composer.addPass(bloomPass);
	composer.addPass(new OutputPass());

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.035);
	scene.environment = envRT.texture;
	scene.environmentIntensity = 0.78;
	pmrem.dispose();

	// Stark SpaceX-grade high-contrast studio rim lighting on pure black
	const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
	keyLight.position.set(5.5, 6.2, 5.8);
	scene.add(keyLight);

	const rimLight = new THREE.DirectionalLight(0xbae6fd, 2.0);
	rimLight.position.set(-6.0, 2.5, -4.8);
	scene.add(rimLight);

	const accentLight = new THREE.PointLight(edition.accentRim, 7.5, 14, 1.6);
	accentLight.position.set(2.4, -2.6, 3.2);
	scene.add(accentLight);

	const dust = createDeepSpaceDust();
	scene.add(dust);

	const stageAnchor = new THREE.Group();
	scene.add(stageAnchor);

	const sculptureGroup = new THREE.Group();
	sculptureGroup.rotation.set(...edition.initialTilt);
	sculptureGroup.scale.setScalar(edition.scale);
	stageAnchor.add(sculptureGroup);

	// Sub-parts for subtle organic secondary motion per edition
	let primaryPart: THREE.Object3D | null = null;
	let secondaryPart: THREE.Object3D | null = null;
	let meltBasePositions: Float32Array | null = null;
	let meltGeoRef: THREE.BufferGeometry | null = null;

	// Bespoke luxury PBR materials applied per mesh name
	const applyBespokeMaterial = (mesh: THREE.Mesh) => {
		switch (mesh.name) {
			case 'Nano_Core':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0x0d9488,
					emissive: 0x042f2e,
					emissiveIntensity: 0.55,
					metalness: 0.9,
					roughness: 0.12,
					iridescence: 1.0,
					iridescenceIOR: 1.5,
					clearcoat: 1.0,
				});
				primaryPart = mesh;
				break;
			case 'Nano_Cage':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xd8dee9,
					metalness: 0.95,
					roughness: 0.17,
					clearcoat: 0.6,
				});
				secondaryPart = mesh;
				break;
			case 'Nano_Satellites':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xe0f2fe,
					emissive: 0x0ea5e9,
					emissiveIntensity: 0.35,
					metalness: 0.94,
					roughness: 0.08,
				});
				break;

			case 'Kinoko_Cap':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xb91c1c,
					emissive: 0x2a0408,
					emissiveIntensity: 0.35,
					metalness: 0.86,
					roughness: 0.13,
					clearcoat: 1.0,
					clearcoatRoughness: 0.06,
				});
				break;
			case 'Kinoko_Spots':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xf1f5f9,
					metalness: 0.94,
					roughness: 0.1,
					clearcoat: 1.0,
				});
				break;
			case 'Kinoko_Stem':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xcbd5e1,
					metalness: 0.9,
					roughness: 0.2,
					clearcoat: 0.55,
				});
				break;
			case 'Kinoko_Eyes':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0x030508,
					metalness: 0.95,
					roughness: 0.04,
					clearcoat: 1.0,
				});
				break;

			case 'Melt_Body': {
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xe2e8f0,
					metalness: 1.0,
					roughness: 0.04,
					iridescence: 0.45,
					iridescenceIOR: 1.4,
					clearcoat: 1.0,
				});
				primaryPart = mesh;
				const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
				meltBasePositions = new Float32Array(posAttr.array as ArrayLike<number>);
				meltGeoRef = mesh.geometry;
				break;
			}
			case 'Melt_Droplets':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xcbd5e1,
					metalness: 0.98,
					roughness: 0.07,
					clearcoat: 1.0,
				});
				secondaryPart = mesh;
				break;

			case 'Wafer_Disc':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0x111827,
					metalness: 0.92,
					roughness: 0.11,
					iridescence: 1.0,
					iridescenceIOR: 1.75,
					iridescenceThicknessRange: [180, 520],
					clearcoat: 1.0,
				});
				primaryPart = mesh;
				break;
			case 'Wafer_AcousticRings':
				mesh.material = new THREE.MeshPhysicalMaterial({
					color: 0xe2e8f0,
					metalness: 0.95,
					roughness: 0.16,
					clearcoat: 0.8,
				});
				secondaryPart = mesh;
				break;
		}
	};

	const loader = new GLTFLoader();
	loader.load(edition.file, (gltf) => {
		const children = [...gltf.scene.children];
		for (const child of children) {
			if ((child as THREE.Mesh).isMesh) {
				applyBespokeMaterial(child as THREE.Mesh);
			}
			sculptureGroup.add(child);
		}
		root.dataset.modelLoaded = 'true';
	});

	// Effortless subtle interaction (pointer parallax + optional drag inertia)
	let pointerX = 0;
	let pointerY = 0;
	let smoothX = 0;
	let smoothY = 0;
	let dragRotX = 0;
	let dragRotY = 0;
	let velX = 0;
	let velY = 0;
	let dragging = false;
	let prevX = 0;
	let prevY = 0;
	let scrollProgress = 0;

	const onPointerMove = (e: PointerEvent) => {
		pointerX = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
		pointerY = -((e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1);
		if (!dragging) return;
		const dx = e.clientX - prevX;
		const dy = e.clientY - prevY;
		prevX = e.clientX;
		prevY = e.clientY;
		velY = dx * 0.006;
		velX = dy * 0.005;
		dragRotY += velY;
		dragRotX = THREE.MathUtils.clamp(dragRotX + velX, -0.95, 0.95);
	};

	const onPointerDown = (e: PointerEvent) => {
		if ((e.target as HTMLElement | null)?.closest('a, button')) return;
		dragging = true;
		prevX = e.clientX;
		prevY = e.clientY;
	};

	const onPointerUp = () => {
		dragging = false;
	};

	window.addEventListener('pointermove', onPointerMove, { passive: true });
	window.addEventListener('pointerdown', onPointerDown, { passive: true });
	window.addEventListener('pointerup', onPointerUp, { passive: true });
	window.addEventListener('pointercancel', onPointerUp, { passive: true });

	const updateScroll = () => {
		const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
		scrollProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
	};
	window.addEventListener('scroll', updateScroll, { passive: true });
	updateScroll();

	let isMobile = window.innerWidth < 860;
	const updateSize = () => {
		const rect = root.getBoundingClientRect();
		const w = Math.max(rect.width || window.innerWidth, 1);
		const h = Math.max(rect.height || window.innerHeight, 1);
		isMobile = w < 860;

		camera.aspect = w / h;
		camera.fov = isMobile ? 42 : 35;
		camera.updateProjectionMatrix();

		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		bloomPass.resolution.set(w, h);
	};
	window.addEventListener('resize', updateSize);
	updateSize();

	let rafId = 0;
	let visible = true;
	const clock = new THREE.Clock();

	const onVis = () => {
		visible = !document.hidden;
		if (visible) clock.getDelta();
	};
	document.addEventListener('visibilitychange', onVis);

	const animate = () => {
		rafId = window.requestAnimationFrame(animate);
		if (!visible) return;

		clock.getDelta();
		const t = clock.elapsedTime;

		smoothX += (pointerX - smoothX) * 0.045;
		smoothY += (pointerY - smoothY) * 0.045;

		if (!dragging) {
			velX *= 0.93;
			velY *= 0.93;
			dragRotX = THREE.MathUtils.clamp(dragRotX + velX, -0.95, 0.95);
			dragRotY += velY;
		}

		// SpaceX full-bleed framing: centered-right on desktop so bottom-left text breathes cleanly; upper-center on mobile
		if (variant === 'home') {
			const xHero = isMobile ? 0.0 : 1.05;
			const xScroll = isMobile ? 0.0 : Math.cos(scrollProgress * Math.PI * 1.5) * 1.15;
			const heroBlend = Math.max(0, 1 - scrollProgress * 2.2);

			const targetX = THREE.MathUtils.lerp(xScroll, xHero, heroBlend);
			const targetY = isMobile
				? THREE.MathUtils.lerp(-0.05, 0.52, heroBlend)
				: THREE.MathUtils.lerp(-0.04, 0.14, heroBlend);
			const targetZ = isMobile
				? THREE.MathUtils.lerp(-1.1, -0.15, heroBlend)
				: THREE.MathUtils.lerp(-0.55, 0.35, heroBlend);

			stageAnchor.position.x += (targetX - stageAnchor.position.x) * 0.07;
			stageAnchor.position.y += (targetY - stageAnchor.position.y) * 0.07;
			stageAnchor.position.z += (targetZ - stageAnchor.position.z) * 0.07;
		} else {
			const targetX = isMobile ? 0.0 : 1.18;
			const targetY = isMobile ? 0.38 : 0.08;
			const targetZ = isMobile ? -0.35 : 0.25;
			stageAnchor.position.x += (targetX - stageAnchor.position.x) * 0.08;
			stageAnchor.position.y += (targetY - stageAnchor.position.y) * 0.08;
			stageAnchor.position.z += (targetZ - stageAnchor.position.z) * 0.08;
		}

		const baseSpin = reducedMotion ? 0 : t * 0.19;
		const floatY = reducedMotion ? 0 : Math.sin(t * 0.85) * 0.06;
		sculptureGroup.position.y = floatY;
		sculptureGroup.rotation.x =
			edition.initialTilt[0] + dragRotX - smoothY * 0.14 + scrollProgress * 0.35;
		sculptureGroup.rotation.y =
			edition.initialTilt[1] + baseSpin + dragRotY + smoothX * 0.22 + scrollProgress * 1.8;

		// Subtle edition-specific secondary life
		if (!reducedMotion) {
			if (secondaryPart) {
				secondaryPart.rotation.y = -t * 0.28;
				secondaryPart.rotation.z = Math.sin(t * 0.4) * 0.14;
			}
			if (primaryPart && !meltGeoRef) {
				primaryPart.rotation.z = Math.sin(t * 0.5) * 0.08;
			}
			// Real-time liquid metal surface ripple on Edition 03
			if (meltGeoRef && meltBasePositions) {
				const pos = meltGeoRef.attributes.position as THREE.BufferAttribute;
				const arr = pos.array as Float32Array;
				for (let i = 0; i < pos.count; i++) {
					const bx = meltBasePositions[i * 3];
					const by = meltBasePositions[i * 3 + 1];
					const bz = meltBasePositions[i * 3 + 2];
					const ripple =
						1 +
						Math.sin(bx * 2.6 + t * 1.7) *
							Math.cos(by * 2.4 - t * 1.3) *
							0.045;
					arr[i * 3] = bx * ripple;
					arr[i * 3 + 1] = by * ripple;
					arr[i * 3 + 2] = bz * ripple;
				}
				pos.needsUpdate = true;
			}
			dust.rotation.y = t * 0.015;
		}

		composer.render();
	};

	animate();

	return () => {
		window.cancelAnimationFrame(rafId);
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerdown', onPointerDown);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		window.removeEventListener('scroll', updateScroll);
		window.removeEventListener('resize', updateSize);
		document.removeEventListener('visibilitychange', onVis);
		envRT.dispose();
		composer.dispose();
		renderer.dispose();
	};
}
