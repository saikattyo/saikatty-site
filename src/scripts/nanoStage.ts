import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type StageMode = 'nano' | 'flux' | 'matrix';

interface ModePreset {
	label: string;
	caption: string;
	coreColor: number;
	coreEmissive: number;
	shellColor: number;
	cageColor: number;
	outerRingColor: number;
	innerRingColor: number;
	keyLightColor: number;
	rimLightColor: number;
	fluxScale: number;
	matrixOpacity: number;
	cageScale: number;
	shellScale: number;
	spinSpeed: number;
	particleMix: number;
}

const MODE_PRESETS: Record<StageMode, ModePreset> = {
	nano: {
		label: '01 / NANO CLUSTER',
		caption: '数十nm制御・有機ナノ粒子クラスター',
		coreColor: 0x14b8a6,
		coreEmissive: 0x0b4f4a,
		shellColor: 0x99f6e4,
		cageColor: 0xe2e8f0,
		outerRingColor: 0x5eead4,
		innerRingColor: 0xfb7185,
		keyLightColor: 0x5eead4,
		rimLightColor: 0x38bdf8,
		fluxScale: 0.001,
		matrixOpacity: 0.08,
		cageScale: 1.0,
		shellScale: 1.0,
		spinSpeed: 1.0,
		particleMix: 0.0,
	},
	flux: {
		label: '02 / ENERGY FLUX',
		caption: '次世代蓄電・資源循環トーラスフィールド',
		coreColor: 0xf59e0b,
		coreEmissive: 0x7c2d12,
		shellColor: 0xfde68a,
		cageColor: 0x99f6e4,
		outerRingColor: 0xfbbf24,
		innerRingColor: 0x2dd4bf,
		keyLightColor: 0xfbbf24,
		rimLightColor: 0xf43f5e,
		fluxScale: 1.08,
		matrixOpacity: 0.14,
		cageScale: 1.14,
		shellScale: 0.94,
		spinSpeed: 1.75,
		particleMix: 0.55,
	},
	matrix: {
		label: '03 / SIGNAL MATRIX',
		caption: 'Software × AI × 社会実装ラティス',
		coreColor: 0x60a5fa,
		coreEmissive: 0x1e3a8a,
		shellColor: 0xc4b5fd,
		cageColor: 0x7dd3fc,
		outerRingColor: 0x818cf8,
		innerRingColor: 0x5eead4,
		keyLightColor: 0x818cf8,
		rimLightColor: 0x2dd4bf,
		fluxScale: 0.62,
		matrixOpacity: 0.72,
		cageScale: 1.06,
		shellScale: 1.12,
		spinSpeed: 0.78,
		particleMix: 1.0,
	},
};

const PARTICLE_VERTEX = /* glsl */ `
	attribute float aScale;
	attribute float aPhase;
	uniform float uTime;
	uniform float uPixelRatio;
	uniform float uExplode;
	varying float vAlpha;
	varying float vPhase;

	void main() {
		vec3 pos = position;
		float breathe = 1.0 + sin(uTime * 0.9 + aPhase * 6.2831) * 0.06 + uExplode * 0.28;
		pos *= breathe;
		pos.y += sin(uTime * 0.65 + aPhase * 12.0) * 0.07;
		pos.x += cos(uTime * 0.52 + aPhase * 9.0) * 0.05;

		vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
		gl_Position = projectionMatrix * mvPosition;
		gl_PointSize = aScale * uPixelRatio * (135.0 / max(-mvPosition.z, 1.2));
		vAlpha = smoothstep(11.0, 2.2, -mvPosition.z) * (0.45 + 0.45 * sin(uTime * 1.6 + aPhase * 18.0));
		vPhase = aPhase;
	}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
	uniform float uMix;
	varying float vAlpha;
	varying float vPhase;

	void main() {
		vec2 uv = gl_PointCoord - vec2(0.5);
		float d = length(uv);
		if (d > 0.5) discard;

		float glow = pow(1.0 - d * 2.0, 2.1);
		vec3 colNano = mix(vec3(0.37, 0.92, 0.83), vec3(0.55, 0.85, 0.99), vPhase);
		vec3 colFlux = mix(vec3(0.98, 0.75, 0.18), vec3(0.96, 0.32, 0.46), vPhase);
		vec3 colMatrix = mix(vec3(0.51, 0.55, 0.98), vec3(0.37, 0.92, 0.83), vPhase);

		vec3 col = uMix < 0.5
			? mix(colNano, colFlux, uMix * 2.0)
			: mix(colFlux, colMatrix, (uMix - 0.5) * 2.0);

		gl_FragColor = vec4(col, glow * vAlpha);
	}
`;

function buildConstellationLattice(): THREE.LineSegments {
	const nodes: THREE.Vector3[] = [];
	const count = 42;
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < count; i++) {
		const y = 1 - (i / (count - 1)) * 2;
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = golden * i;
		const radius = 2.25 + (i % 3) * 0.22;
		nodes.push(
			new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius)
		);
	}

	const linePositions: number[] = [];
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const dist = nodes[i].distanceTo(nodes[j]);
			if (dist < 1.48) {
				linePositions.push(
					nodes[i].x,
					nodes[i].y,
					nodes[i].z,
					nodes[j].x,
					nodes[j].y,
					nodes[j].z
				);
			}
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
	const mat = new THREE.LineBasicMaterial({
		color: 0x7dd3fc,
		transparent: true,
		opacity: 0.08,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	return new THREE.LineSegments(geo, mat);
}

export function initNanoStage(root: HTMLElement): () => void {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-nano-canvas]');
	if (!canvas) return () => {};

	const variant = (root.dataset.variant || 'home') as 'home' | 'compact';
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			powerPreference: 'high-performance',
		});
	} catch {
		root.classList.add('webgl-fallback');
		return () => {};
	}

	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.24;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
	camera.position.set(0, 0.1, 6.8);

	// Studio reflection environment
	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = envRT.texture;
	pmrem.dispose();

	// Dynamic lighting rig
	const keyLight = new THREE.PointLight(0x5eead4, 18, 18, 1.6);
	keyLight.position.set(3.4, 2.8, 4.2);
	scene.add(keyLight);

	const rimLight = new THREE.PointLight(0x38bdf8, 14, 18, 1.6);
	rimLight.position.set(-3.8, -2.2, 2.5);
	scene.add(rimLight);

	const topSpot = new THREE.DirectionalLight(0xffffff, 1.35);
	topSpot.position.set(0.5, 5.0, 3.0);
	scene.add(topSpot);

	// Master rig
	const worldGroup = new THREE.Group();
	scene.add(worldGroup);

	const orbitGroup = new THREE.Group();
	worldGroup.add(orbitGroup);

	// Materials upgraded onto GLB meshes
	const coreMat = new THREE.MeshPhysicalMaterial({
		color: 0x14b8a6,
		emissive: 0x0b4f4a,
		emissiveIntensity: 0.65,
		metalness: 0.88,
		roughness: 0.15,
		iridescence: 1.0,
		iridescenceIOR: 1.65,
		clearcoat: 1.0,
		clearcoatRoughness: 0.08,
	});

	const shellMat = new THREE.MeshPhysicalMaterial({
		color: 0x99f6e4,
		metalness: 0.06,
		roughness: 0.07,
		transmission: 0.72,
		ior: 1.48,
		thickness: 0.85,
		transparent: true,
		opacity: 0.82,
		clearcoat: 1.0,
		side: THREE.DoubleSide,
	});

	const cageMat = new THREE.MeshPhysicalMaterial({
		color: 0xe2e8f0,
		metalness: 0.92,
		roughness: 0.18,
		clearcoat: 0.85,
	});

	const outerRingMat = new THREE.MeshStandardMaterial({
		color: 0x5eead4,
		emissive: 0x0f766e,
		emissiveIntensity: 0.42,
		metalness: 0.86,
		roughness: 0.2,
	});

	const innerRingMat = new THREE.MeshStandardMaterial({
		color: 0xfb7185,
		emissive: 0x881337,
		emissiveIntensity: 0.36,
		metalness: 0.84,
		roughness: 0.22,
	});

	// Sub-mesh references populated on GLB load (with instant procedural placeholder until loaded)
	let coreMesh: THREE.Object3D | null = null;
	let shellGroup = new THREE.Group();
	let cageMesh: THREE.Object3D | null = null;
	let outerRingMesh: THREE.Object3D | null = null;
	let innerRingMesh: THREE.Object3D | null = null;
	orbitGroup.add(shellGroup);

	// Energy Flux TorusKnot (prominent in mode 'flux')
	const fluxKnotGeo = new THREE.TorusKnotGeometry(1.02, 0.022, 180, 16, 2, 3);
	const fluxKnotMat = new THREE.MeshStandardMaterial({
		color: 0xfbbf24,
		emissive: 0xf59e0b,
		emissiveIntensity: 1.15,
		metalness: 0.5,
		roughness: 0.15,
	});
	const fluxKnot = new THREE.Mesh(fluxKnotGeo, fluxKnotMat);
	fluxKnot.scale.setScalar(0.001);
	orbitGroup.add(fluxKnot);

	// Signal Constellation Lattice (prominent in mode 'matrix')
	const constellation = buildConstellationLattice();
	orbitGroup.add(constellation);

	// Load authentic binary 3D model `/models/nano-assembly.glb`
	const loader = new GLTFLoader();
	loader.load(
		'/models/nano-assembly.glb',
		(gltf) => {
			gltf.scene.traverse((child) => {
				if (!(child as THREE.Mesh).isMesh) return;
				const mesh = child as THREE.Mesh;
				if (mesh.name === 'CoreNucleus') {
					mesh.material = coreMat;
					coreMesh = mesh;
				} else if (mesh.name === 'RefractiveShell') {
					mesh.material = shellMat;
					const edges = new THREE.EdgesGeometry(mesh.geometry, 12);
					const edgeLines = new THREE.LineSegments(
						edges,
						new THREE.LineBasicMaterial({
							color: 0x5eead4,
							transparent: true,
							opacity: 0.36,
							blending: THREE.AdditiveBlending,
						})
					);
					mesh.add(edgeLines);
				} else if (mesh.name === 'MolecularCage') {
					mesh.material = cageMat;
					cageMesh = mesh;
				} else if (mesh.name === 'GimbalRingOuter') {
					mesh.material = outerRingMat;
					outerRingMesh = mesh;
				} else if (mesh.name === 'GimbalRingInner') {
					mesh.material = innerRingMat;
					innerRingMesh = mesh;
				}
			});

			// Re-parent so we can animate each sub-assembly independently
			const children = [...gltf.scene.children];
			for (const c of children) {
				if (c.name === 'RefractiveShell') {
					shellGroup.add(c);
				} else {
					orbitGroup.add(c);
				}
			}

			root.dataset.modelLoaded = 'true';
			document.querySelectorAll<HTMLElement>('[data-stage-status]').forEach((el) => {
				el.textContent = 'GLB 3D LIVE';
			});
		},
		undefined,
		() => {
			// Fallback procedural core if network interrupted
			const fallback = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 2), coreMat);
			orbitGroup.add(fallback);
			coreMesh = fallback;
		}
	);

	// GPU Nanoparticle Dispersion Cloud
	const particleCount = variant === 'compact' ? 360 : 720;
	const pPositions = new Float32Array(particleCount * 3);
	const pScales = new Float32Array(particleCount);
	const pPhases = new Float32Array(particleCount);

	for (let i = 0; i < particleCount; i++) {
		const band = i % 3 === 0 ? 1.55 + Math.random() * 0.9 : 2.35 + Math.random() * 2.4;
		const u = Math.random();
		const v = Math.random();
		const theta = u * Math.PI * 2;
		const phi = Math.acos(2 * v - 1);
		pPositions[i * 3] = band * Math.sin(phi) * Math.cos(theta);
		pPositions[i * 3 + 1] = band * Math.sin(phi) * Math.sin(theta) * 0.78;
		pPositions[i * 3 + 2] = band * Math.cos(phi);
		pScales[i] = 0.55 + Math.random() * 1.45;
		pPhases[i] = Math.random();
	}

	const particleGeo = new THREE.BufferGeometry();
	particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
	particleGeo.setAttribute('aScale', new THREE.BufferAttribute(pScales, 1));
	particleGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhases, 1));

	const particleUniforms = {
		uTime: { value: 0 },
		uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
		uExplode: { value: 0 },
		uMix: { value: 0 },
	};

	const particleMat = new THREE.ShaderMaterial({
		vertexShader: PARTICLE_VERTEX,
		fragmentShader: PARTICLE_FRAGMENT,
		uniforms: particleUniforms,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});

	const particleSystem = new THREE.Points(particleGeo, particleMat);
	worldGroup.add(particleSystem);

	// Interactive state
	let activeMode: StageMode = 'nano';
	let exploded = false;
	let currentExplode = 0;
	let scrollProgress = 0;

	let pointerX = 0;
	let pointerY = 0;
	let smoothPointerX = 0;
	let smoothPointerY = 0;

	let userRotX = 0.14;
	let userRotY = -0.35;
	let velRotX = 0;
	let velRotY = 0;
	let isDragging = false;
	let lastDragX = 0;
	let lastDragY = 0;

	// Target color scratch objects
	const targetCoreCol = new THREE.Color(MODE_PRESETS.nano.coreColor);
	const targetCoreEmissive = new THREE.Color(MODE_PRESETS.nano.coreEmissive);
	const targetShellCol = new THREE.Color(MODE_PRESETS.nano.shellColor);
	const targetCageCol = new THREE.Color(MODE_PRESETS.nano.cageColor);
	const targetOuterCol = new THREE.Color(MODE_PRESETS.nano.outerRingColor);
	const targetInnerCol = new THREE.Color(MODE_PRESETS.nano.innerRingColor);
	const targetKeyLight = new THREE.Color(MODE_PRESETS.nano.keyLightColor);
	const targetRimLight = new THREE.Color(MODE_PRESETS.nano.rimLightColor);

	const captionEl = document.querySelector<HTMLElement>('[data-stage-caption]');
	const modeLabelEl = document.querySelector<HTMLElement>('[data-stage-mode-label]');
	const telemetryEl = document.querySelector<HTMLElement>('[data-stage-telemetry]');
	const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-stage-mode]'));
	const explodeButtons = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-stage-explode]')
	);

	const applyMode = (mode: StageMode) => {
		activeMode = mode;
		const preset = MODE_PRESETS[mode];
		targetCoreCol.setHex(preset.coreColor);
		targetCoreEmissive.setHex(preset.coreEmissive);
		targetShellCol.setHex(preset.shellColor);
		targetCageCol.setHex(preset.cageColor);
		targetOuterCol.setHex(preset.outerRingColor);
		targetInnerCol.setHex(preset.innerRingColor);
		targetKeyLight.setHex(preset.keyLightColor);
		targetRimLight.setHex(preset.rimLightColor);

		if (captionEl) captionEl.textContent = preset.caption;
		if (modeLabelEl) modeLabelEl.textContent = preset.label;

		for (const btn of modeButtons) {
			const isCurrent = btn.dataset.stageMode === mode;
			btn.classList.toggle('is-active', isCurrent);
			btn.setAttribute('aria-pressed', String(isCurrent));
		}

		// Subtle impulse spin on switch
		velRotY += 0.035;
	};

	const toggleExplode = (next?: boolean) => {
		exploded = typeof next === 'boolean' ? next : !exploded;
		for (const btn of explodeButtons) {
			btn.classList.toggle('is-active', exploded);
			btn.setAttribute('aria-pressed', String(exploded));
		}
	};

	for (const btn of modeButtons) {
		btn.addEventListener('click', () => {
			const m = btn.dataset.stageMode as StageMode | undefined;
			if (m && m in MODE_PRESETS) applyMode(m);
		});
	}

	for (const btn of explodeButtons) {
		btn.addEventListener('click', () => toggleExplode());
	}

	// Keyboard shortcuts 1 / 2 / 3 / E when not typing in inputs
	const onKeyDown = (e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		if (e.key === '1') applyMode('nano');
		else if (e.key === '2') applyMode('flux');
		else if (e.key === '3') applyMode('matrix');
		else if (e.key === 'e' || e.key === 'E') toggleExplode();
	};
	window.addEventListener('keydown', onKeyDown);

	// Pointer parallax across window
	const onPointerMoveWindow = (e: PointerEvent) => {
		pointerX = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
		pointerY = -((e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1);
	};
	window.addEventListener('pointermove', onPointerMoveWindow, { passive: true });

	// Direct 3D drag zone(s)
	const dragZones = Array.from(document.querySelectorAll<HTMLElement>('[data-stage-drag]'));
	const cleanupsDrag: Array<() => void> = [];

	for (const zone of dragZones) {
		const down = (e: PointerEvent) => {
			isDragging = true;
			lastDragX = e.clientX;
			lastDragY = e.clientY;
			zone.classList.add('is-dragging');
		};
		const move = (e: PointerEvent) => {
			if (!isDragging) return;
			const dx = e.clientX - lastDragX;
			const dy = e.clientY - lastDragY;
			lastDragX = e.clientX;
			lastDragY = e.clientY;
			velRotY = dx * 0.0075;
			velRotX = dy * 0.006;
			userRotY += velRotY;
			userRotX = Math.max(-1.25, Math.min(1.25, userRotX + velRotX));
		};
		const up = () => {
			if (!isDragging) return;
			isDragging = false;
			zone.classList.remove('is-dragging');
		};

		zone.addEventListener('pointerdown', down);
		window.addEventListener('pointermove', move, { passive: true });
		window.addEventListener('pointerup', up, { passive: true });
		window.addEventListener('pointercancel', up, { passive: true });

		cleanupsDrag.push(() => {
			zone.removeEventListener('pointerdown', down);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		});
	}

	// Scroll choreography
	const updateScroll = () => {
		const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
		scrollProgress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
	};
	window.addEventListener('scroll', updateScroll, { passive: true });
	updateScroll();

	// Responsive sizing & exact anchor projection
	let isMobileLayout = false;
	let heroAnchorX = 1.45;
	let heroAnchorY = 0.05;
	let rigBaseScale = 1.0;
	const anchorEl = document.querySelector<HTMLElement>('[data-stage-anchor]');

	const updateSize = () => {
		const rect = root.getBoundingClientRect();
		const width = Math.max(rect.width || window.innerWidth, 1);
		const height = Math.max(rect.height || window.innerHeight, 1);
		isMobileLayout = width < 860;

		camera.aspect = width / height;
		camera.fov = isMobileLayout ? 42 : 38;
		camera.updateProjectionMatrix();

		renderer.setSize(width, height, false);
		particleUniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);

		if (anchorEl) {
			const aRect = anchorEl.getBoundingClientRect();
			const docTop = variant === 'home' ? aRect.top + window.scrollY : aRect.top - rect.top;
			const centerX = aRect.left - (variant === 'home' ? 0 : rect.left) + aRect.width * 0.5;
			const centerY = docTop + aRect.height * 0.5;

			const ndcX = (centerX / width) * 2 - 1;
			const ndcY = -((centerY / height) * 2 - 1);

			const dist = camera.position.z;
			const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist;
			const halfW = halfH * camera.aspect;

			heroAnchorX = ndcX * halfW;
			heroAnchorY = camera.position.y + ndcY * halfH;

			const boxWorldW = (aRect.width / width) * (halfW * 2);
			const boxWorldH = (aRect.height / height) * (halfH * 2);
			const fitRadius = Math.min(boxWorldW, boxWorldH) * 0.5;
			rigBaseScale = THREE.MathUtils.clamp(fitRadius / 2.25, 0.52, 1.08);
		} else {
			heroAnchorX = isMobileLayout ? 0 : 1.42;
			heroAnchorY = isMobileLayout ? 0.85 : 0.05;
			rigBaseScale = isMobileLayout ? 0.62 : 1.0;
		}
	};
	window.addEventListener('resize', updateSize);
	requestAnimationFrame(updateSize);
	updateSize();

	let rafId = 0;
	let isVisible = true;
	const clock = new THREE.Clock();

	const onVisibility = () => {
		isVisible = !document.hidden;
		if (isVisible) clock.getDelta();
	};
	document.addEventListener('visibilitychange', onVisibility);

	const animate = () => {
		rafId = window.requestAnimationFrame(animate);
		if (!isVisible) return;

		const dt = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;
		const preset = MODE_PRESETS[activeMode];
		const lerpAmt = 1 - Math.pow(0.04, dt);

		smoothPointerX += (pointerX - smoothPointerX) * 0.06;
		smoothPointerY += (pointerY - smoothPointerY) * 0.06;

		// Inertia decay when not dragging
		if (!isDragging) {
			velRotX *= 0.92;
			velRotY *= 0.92;
			userRotX = Math.max(-1.25, Math.min(1.25, userRotX + velRotX));
			userRotY += velRotY;
		}

		// Explode factor: manual toggle OR gentle scroll expansion on home
		const scrollExplode =
			variant === 'home' ? Math.sin(Math.min(scrollProgress * 1.35, 1) * Math.PI) * 0.32 : 0;
		const targetExplode = exploded ? 1.0 : scrollExplode;
		currentExplode += (targetExplode - currentExplode) * lerpAmt;

		// Smooth material transitions
		coreMat.color.lerp(targetCoreCol, lerpAmt);
		coreMat.emissive.lerp(targetCoreEmissive, lerpAmt);
		shellMat.color.lerp(targetShellCol, lerpAmt);
		cageMat.color.lerp(targetCageCol, lerpAmt);
		outerRingMat.color.lerp(targetOuterCol, lerpAmt);
		innerRingMat.color.lerp(targetInnerCol, lerpAmt);
		keyLight.color.lerp(targetKeyLight, lerpAmt);
		rimLight.color.lerp(targetRimLight, lerpAmt);

		const lineMat = constellation.material as THREE.LineBasicMaterial;
		lineMat.opacity += (preset.matrixOpacity - lineMat.opacity) * lerpAmt;

		const targetFlux = preset.fluxScale * (1 + currentExplode * 0.18);
		const nextFlux = fluxKnot.scale.x + (targetFlux - fluxKnot.scale.x) * lerpAmt;
		fluxKnot.scale.setScalar(Math.max(0.001, nextFlux));

		particleUniforms.uMix.value += (preset.particleMix - particleUniforms.uMix.value) * lerpAmt;
		particleUniforms.uExplode.value = currentExplode;
		if (!reducedMotion) {
			particleUniforms.uTime.value = elapsed;
		}

		// Position rig cleanly for desktop vs mobile + scroll choreography
		if (variant === 'home') {
			const heroWeight = Math.max(0, 1 - scrollProgress * 2.2);
			const driftX = isMobileLayout
				? Math.sin(scrollProgress * Math.PI * 2) * 0.25
				: Math.cos(scrollProgress * Math.PI * 1.6) * 1.35;
			const driftY = isMobileLayout ? -0.1 : -0.15;
			const targetX = THREE.MathUtils.lerp(driftX, heroAnchorX, heroWeight);
			const targetY = THREE.MathUtils.lerp(driftY, heroAnchorY, heroWeight);
			const targetZ = THREE.MathUtils.lerp(isMobileLayout ? -1.9 : -1.25, 0, heroWeight);

			worldGroup.position.x += (targetX - worldGroup.position.x) * 0.1;
			worldGroup.position.y += (targetY - worldGroup.position.y) * 0.1;
			worldGroup.position.z += (targetZ - worldGroup.position.z) * 0.1;
			orbitGroup.scale.setScalar(
				orbitGroup.scale.x + (rigBaseScale - orbitGroup.scale.x) * 0.1
			);
		} else {
			worldGroup.position.x += (heroAnchorX - worldGroup.position.x) * 0.1;
			worldGroup.position.y += (heroAnchorY - worldGroup.position.y) * 0.1;
			worldGroup.position.z += (0 - worldGroup.position.z) * 0.1;
			orbitGroup.scale.setScalar(
				orbitGroup.scale.x + (rigBaseScale - orbitGroup.scale.x) * 0.1
			);
		}

		// Sub-mesh animations & CAD exploded scaling
		const autoSpin = reducedMotion ? 0 : elapsed * 0.24 * preset.spinSpeed;
		orbitGroup.rotation.y = userRotY + autoSpin + scrollProgress * Math.PI * 0.85 + smoothPointerX * 0.28;
		orbitGroup.rotation.x = userRotX + Math.sin(elapsed * 0.35) * (reducedMotion ? 0 : 0.08) - smoothPointerY * 0.22;

		if (coreMesh) {
			const pulse = reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.1) * 0.035;
			coreMesh.scale.setScalar(pulse * (1 - currentExplode * 0.08));
			if (!reducedMotion) coreMesh.rotation.y = -elapsed * 0.32;
		}

		const desiredShell = preset.shellScale * (1 + currentExplode * 0.28);
		shellGroup.scale.setScalar(
			shellGroup.scale.x + (desiredShell - shellGroup.scale.x) * lerpAmt
		);
		if (!reducedMotion) {
			shellGroup.rotation.z = elapsed * 0.14;
		}

		if (cageMesh) {
			const desiredCage = preset.cageScale * (1 + currentExplode * 0.44);
			cageMesh.scale.setScalar(
				cageMesh.scale.x + (desiredCage - cageMesh.scale.x) * lerpAmt
			);
			if (!reducedMotion) {
				cageMesh.rotation.x = elapsed * 0.11;
				cageMesh.rotation.y = -elapsed * 0.16;
			}
		}

		if (outerRingMesh) {
			const desiredOuter = 1 + currentExplode * 0.34;
			outerRingMesh.scale.setScalar(
				outerRingMesh.scale.x + (desiredOuter - outerRingMesh.scale.x) * lerpAmt
			);
			if (!reducedMotion) {
				outerRingMesh.rotation.z = elapsed * 0.38 * preset.spinSpeed;
				outerRingMesh.rotation.y = Math.sin(elapsed * 0.45) * 0.35;
			}
		}

		if (innerRingMesh) {
			const desiredInner = 1 + currentExplode * 0.22;
			innerRingMesh.scale.setScalar(
				innerRingMesh.scale.x + (desiredInner - innerRingMesh.scale.x) * lerpAmt
			);
			if (!reducedMotion) {
				innerRingMesh.rotation.x = -elapsed * 0.52 * preset.spinSpeed;
				innerRingMesh.rotation.z = Math.cos(elapsed * 0.4) * 0.3;
			}
		}

		if (!reducedMotion) {
			fluxKnot.rotation.x = elapsed * 0.7;
			fluxKnot.rotation.y = -elapsed * 0.45;
			constellation.rotation.y = -elapsed * 0.09;
			particleSystem.rotation.y = elapsed * 0.045 + smoothPointerX * 0.12;
			particleSystem.rotation.x = smoothPointerY * 0.08;
		}

		keyLight.position.x = 3.4 + smoothPointerX * 1.6;
		keyLight.position.y = 2.8 + smoothPointerY * 1.4;

		if (telemetryEl) {
			const az = (((orbitGroup.rotation.y * 180) / Math.PI) % 360 + 360) % 360;
			const el = (orbitGroup.rotation.x * 180) / Math.PI;
			telemetryEl.textContent = `AZ ${az.toFixed(0).padStart(3, '0')}° / EL ${el >= 0 ? '+' : ''}${el.toFixed(0)}°`;
		}

		renderer.render(scene, camera);
	};

	applyMode('nano');
	animate();

	return () => {
		window.cancelAnimationFrame(rafId);
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('pointermove', onPointerMoveWindow);
		window.removeEventListener('scroll', updateScroll);
		window.removeEventListener('resize', updateSize);
		document.removeEventListener('visibilitychange', onVisibility);
		for (const fn of cleanupsDrag) fn();
		particleGeo.dispose();
		particleMat.dispose();
		fluxKnotGeo.dispose();
		fluxKnotMat.dispose();
		envRT.dispose();
		renderer.dispose();
	};
}
