import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type FlightMode = 'orbit' | 'payload' | 'burn' | 'xray';

const PLANET_VERTEX = /* glsl */ `
	varying vec3 vNormalW;
	varying vec3 vPosW;
	varying vec3 vObjPos;

	void main() {
		vObjPos = position;
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vPosW = worldPosition.xyz;
		vNormalW = normalize(mat3(modelMatrix) * normal);
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const PLANET_FRAGMENT = /* glsl */ `
	uniform vec3 uSunDir;
	uniform float uTime;
	varying vec3 vNormalW;
	varying vec3 vPosW;
	varying vec3 vObjPos;

	float hash(vec3 p) {
		p = fract(p * 0.3183099 + 0.1);
		p *= 17.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}

	float noise(vec3 x) {
		vec3 i = floor(x);
		vec3 f = fract(x);
		f = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
				mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
			mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
				mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
			f.z
		);
	}

	float fbm(vec3 p) {
		float v = 0.0;
		float a = 0.5;
		for (int i = 0; i < 4; i++) {
			v += a * noise(p);
			p *= 2.04;
			a *= 0.5;
		}
		return v;
	}

	void main() {
		vec3 viewDir = normalize(cameraPosition - vPosW);
		vec3 n = normalize(vNormalW);
		float ndotl = dot(n, uSunDir);
		float dayFactor = smoothstep(-0.14, 0.28, ndotl);
		float twilight = smoothstep(-0.22, 0.06, ndotl) * (1.0 - smoothstep(0.06, 0.34, ndotl));

		vec3 sphereCoord = normalize(vObjPos) * 4.6;
		float continent = fbm(sphereCoord + vec3(1.7, 0.4, -2.1));
		float clouds = fbm(sphereCoord * 1.9 + vec3(uTime * 0.008, 0.0, uTime * 0.004));
		float isLand = smoothstep(0.49, 0.55, continent);

		// Day side: deep orbital cobalt ocean + muted slate landmass + crisp white cloud decks
		vec3 oceanCol = vec3(0.025, 0.095, 0.24);
		vec3 landCol = vec3(0.07, 0.12, 0.15);
		vec3 daySurface = mix(oceanCol, landCol, isLand);

		// Sun specular glint on orbital ocean
		vec3 halfVec = normalize(uSunDir + viewDir);
		float spec = pow(max(dot(n, halfVec), 0.0), 48.0) * (1.0 - isLand) * 0.55;
		daySurface += vec3(0.38, 0.62, 0.95) * spec;

		float cloudMask = smoothstep(0.52, 0.76, clouds);
		daySurface = mix(daySurface, vec3(0.78, 0.86, 0.96), cloudMask * 0.65);

		// Night side: obsidian surface + warm golden-amber city clusters on land
		float cityCluster = smoothstep(0.63, 0.77, fbm(sphereCoord * 5.8)) * isLand;
		vec3 nightCol = vec3(0.005, 0.009, 0.018) + vec3(1.0, 0.68, 0.32) * cityCluster * 0.65;

		vec3 col = mix(nightCol, daySurface * max(ndotl, 0.08) * 1.65, dayFactor);

		// Rayleigh limb scattering on planet surface edge
		float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.4);
		vec3 limbBlue = vec3(0.22, 0.58, 1.0);
		vec3 limbWarm = vec3(0.95, 0.48, 0.22);
		col += mix(limbBlue, limbWarm, twilight * 0.65) * fresnel * (0.28 + 0.75 * smoothstep(-0.28, 0.35, ndotl));

		gl_FragColor = vec4(col, 1.0);
	}
`;

const ATMO_VERTEX = /* glsl */ `
	varying vec3 vNormalW;
	varying vec3 vPosW;

	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vPosW = worldPosition.xyz;
		vNormalW = normalize(mat3(modelMatrix) * normal);
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const ATMO_FRAGMENT = /* glsl */ `
	uniform vec3 uSunDir;
	varying vec3 vNormalW;
	varying vec3 vPosW;

	void main() {
		vec3 viewDir = normalize(cameraPosition - vPosW);
		vec3 n = normalize(vNormalW);
		// BackSide halo rim
		float rim = pow(clamp(1.0 + dot(n, viewDir), 0.0, 1.0), 3.2);
		float sunSide = smoothstep(-0.35, 0.45, dot(-n, uSunDir));
		vec3 horizonCol = mix(vec3(0.08, 0.32, 0.78), vec3(0.36, 0.74, 1.0), sunSide);
		float alpha = rim * (0.15 + 0.85 * sunSide) * 0.92;
		gl_FragColor = vec4(horizonCol, alpha);
	}
`;

const PLUME_VERTEX = /* glsl */ `
	varying vec2 vUv;
	varying vec3 vPos;
	void main() {
		vUv = uv;
		vPos = position;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const PLUME_FRAGMENT = /* glsl */ `
	uniform float uTime;
	uniform float uThrottle;
	varying vec2 vUv;
	varying vec3 vPos;

	void main() {
		if (uThrottle <= 0.005) discard;
		// vUv.y = 1 near nozzle throat, 0 at far exhaust tip
		float axial = vUv.y;
		float radial = abs(vUv.x - 0.5) * 2.0;

		// Supersonic Mach shock diamonds along exhaust axis
		float flicker = 0.92 + 0.08 * sin(uTime * 58.0 + axial * 12.0);
		float diamonds = pow(max(0.0, cos((1.0 - axial) * 26.0 - uTime * 22.0)), 4.0) * axial;

		float coreBeam = smoothstep(0.95, 0.12, axial) * pow(axial, 0.65);
		float edgeFade = pow(max(0.0, 1.0 - radial), 1.6);

		vec3 colCore = vec3(0.85, 0.94, 1.0);
		vec3 colMid = vec3(0.32, 0.68, 1.0);
		vec3 colOuter = vec3(1.0, 0.45, 0.14);

		vec3 col = mix(colOuter, colMid, axial);
		col = mix(col, colCore, diamonds * 0.85 + pow(axial, 3.0) * 0.75);

		float alpha = (coreBeam * 0.85 + diamonds * 0.55) * edgeFade * flicker * uThrottle;
		gl_FragColor = vec4(col * 1.8, clamp(alpha, 0.0, 1.0));
	}
`;

function createStarfield(): THREE.Points {
	const count = 2200;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);

	for (let i = 0; i < count; i++) {
		const r = 28 + Math.random() * 34;
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(2 * Math.random() - 1);
		positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
		positions[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) - 4;

		const tint = Math.random();
		const brightness = 0.45 + Math.random() * 0.55;
		if (tint < 0.25) {
			colors[i * 3] = 0.72 * brightness;
			colors[i * 3 + 1] = 0.86 * brightness;
			colors[i * 3 + 2] = 1.0 * brightness;
		} else if (tint < 0.82) {
			colors[i * 3] = 0.96 * brightness;
			colors[i * 3 + 1] = 0.97 * brightness;
			colors[i * 3 + 2] = 1.0 * brightness;
		} else {
			colors[i * 3] = 1.0 * brightness;
			colors[i * 3 + 1] = 0.85 * brightness;
			colors[i * 3 + 2] = 0.68 * brightness;
		}
	}

	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

	const mat = new THREE.PointsMaterial({
		size: 0.085,
		vertexColors: true,
		transparent: true,
		opacity: 0.9,
		sizeAttenuation: true,
		depthWrite: false,
	});

	return new THREE.Points(geo, mat);
}

export function initOrbitalStage(root: HTMLElement): () => void {
	const canvas = root.querySelector<HTMLCanvasElement>('[data-orbital-canvas]');
	if (!canvas) return () => {};

	const variant = (root.dataset.variant || 'home') as 'home' | 'compact';
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: false,
			powerPreference: 'high-performance',
		});
	} catch {
		root.classList.add('webgl-fallback');
		return () => {};
	}

	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	renderer.setPixelRatio(dpr);
	renderer.setClearColor(0x020408, 1);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.18;

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x020408);

	const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
	camera.position.set(0, 0.25, 7.6);

	// Post-processing optical HDR bloom (SpaceX sunlight & thruster bloom)
	const composer = new EffectComposer(renderer);
	const renderPass = new RenderPass(scene, camera);
	const bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 768), 0.34, 0.52, 0.86);
	const outputPass = new OutputPass();
	composer.addPass(renderPass);
	composer.addPass(bloomPass);
	composer.addPass(outputPass);

	// Crisp aerospace environment reflection map
	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.03);
	scene.environment = envRT.texture;
	scene.environmentIntensity = 0.85;
	pmrem.dispose();

	// Orbital Sun Light (stark directional sunlight in vacuum) + Earthshine bounce light
	const sunDir = new THREE.Vector3(0.68, 0.46, 0.57).normalize();
	const sunLight = new THREE.DirectionalLight(0xffffff, 3.4);
	sunLight.position.copy(sunDir).multiplyScalar(18);
	scene.add(sunLight);

	const earthshine = new THREE.DirectionalLight(0x3898ff, 1.35);
	earthshine.position.set(-4, -8, 3);
	scene.add(earthshine);

	const rimBackLight = new THREE.DirectionalLight(0x93c5fd, 1.1);
	rimBackLight.position.set(-6, 4, -5);
	scene.add(rimBackLight);

	// Starfield
	const stars = createStarfield();
	scene.add(stars);

	// Planetary Earth Horizon + Rayleigh Atmosphere Shell
	const planetUniforms = {
		uSunDir: { value: sunDir.clone() },
		uTime: { value: 0 },
	};
	const earthGroup = new THREE.Group();
	earthGroup.position.set(-1.2, -16.1, -6.8);
	scene.add(earthGroup);

	const planetGeo = new THREE.SphereGeometry(14.6, 96, 64);
	const planetMat = new THREE.ShaderMaterial({
		vertexShader: PLANET_VERTEX,
		fragmentShader: PLANET_FRAGMENT,
		uniforms: planetUniforms,
	});
	const planetMesh = new THREE.Mesh(planetGeo, planetMat);
	earthGroup.add(planetMesh);

	const atmoGeo = new THREE.SphereGeometry(15.22, 96, 64);
	const atmoMat = new THREE.ShaderMaterial({
		vertexShader: ATMO_VERTEX,
		fragmentShader: ATMO_FRAGMENT,
		uniforms: { uSunDir: { value: sunDir.clone() } },
		side: THREE.BackSide,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});
	const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
	earthGroup.add(atmoMesh);

	// Thin orbital trajectory arc sweeping over Earth
	const orbitArcCurve = new THREE.EllipseCurve(0, 0, 15.55, 15.55, 0.2, 2.9, false, 0);
	const arcPts = orbitArcCurve.getPoints(120).map((p) => new THREE.Vector3(p.x, p.y, 0));
	const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
	const arcMat = new THREE.LineBasicMaterial({
		color: 0x38bdf8,
		transparent: true,
		opacity: 0.22,
		blending: THREE.AdditiveBlending,
	});
	const orbitalArc = new THREE.Line(arcGeo, arcMat);
	orbitalArc.rotation.y = 0.35;
	orbitalArc.rotation.x = 0.18;
	earthGroup.add(orbitalArc);

	// Spacecraft Master Rig
	const craftAnchor = new THREE.Group();
	scene.add(craftAnchor);

	const craftGimbal = new THREE.Group();
	// Default dramatic orbital attitude: nose pitched up-left toward orbital prograde
	craftGimbal.rotation.set(0.32, -0.58, -0.54);
	craftAnchor.add(craftGimbal);

	// Sub-assembly pivots for real mechanical separation & deployment
	const boosterGroup = new THREE.Group();
	const upperStageGroup = new THREE.Group();
	const fairingPortPivot = new THREE.Group();
	const fairingStarboardPivot = new THREE.Group();
	const wingPortPivot = new THREE.Group();
	const wingStarboardPivot = new THREE.Group();

	craftGimbal.add(boosterGroup);
	craftGimbal.add(upperStageGroup);
	upperStageGroup.add(fairingPortPivot);
	upperStageGroup.add(fairingStarboardPivot);
	boosterGroup.add(wingPortPivot);
	boosterGroup.add(wingStarboardPivot);

	// Reactor internal point light (illuminates fairing interior when open!)
	const reactorLight = new THREE.PointLight(0x38bdf8, 4.5, 4.5, 1.6);
	reactorLight.position.set(0, 0.58, 0);
	upperStageGroup.add(reactorLight);

	// Aft Rocket Engine Plume + Dynamic Ignition Light
	const plumeUniforms = {
		uTime: { value: 0 },
		uThrottle: { value: 0 },
	};
	const plumeGroup = new THREE.Group();
	plumeGroup.position.set(0, -2.62, 0);
	boosterGroup.add(plumeGroup);

	const outerPlumeGeo = new THREE.CylinderGeometry(0.42, 0.92, 3.4, 32, 24, true);
	outerPlumeGeo.translate(0, -1.7, 0);
	const plumeMat = new THREE.ShaderMaterial({
		vertexShader: PLUME_VERTEX,
		fragmentShader: PLUME_FRAGMENT,
		uniforms: plumeUniforms,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.AdditiveBlending,
	});
	const outerPlume = new THREE.Mesh(outerPlumeGeo, plumeMat);
	plumeGroup.add(outerPlume);

	const innerPlumeGeo = new THREE.CylinderGeometry(0.18, 0.04, 2.5, 24, 16, true);
	innerPlumeGeo.translate(0, -1.25, 0);
	const innerPlume = new THREE.Mesh(innerPlumeGeo, plumeMat);
	plumeGroup.add(innerPlume);

	const engineBurnLight = new THREE.PointLight(0xff8a3d, 0, 9, 1.5);
	engineBurnLight.position.set(0, -3.1, 0);
	boosterGroup.add(engineBurnLight);

	// Aerospace PBR Materials
	const stainlessMat = new THREE.MeshPhysicalMaterial({
		color: 0xd8dee6,
		metalness: 0.93,
		roughness: 0.19,
		clearcoat: 0.45,
		clearcoatRoughness: 0.18,
	});

	const tpsTileMat = new THREE.MeshStandardMaterial({
		color: 0x0d1015,
		metalness: 0.22,
		roughness: 0.78,
		side: THREE.DoubleSide,
	});

	const engineNozzleMat = new THREE.MeshStandardMaterial({
		color: 0x2c313a,
		emissive: 0xff5500,
		emissiveIntensity: 0.0,
		metalness: 0.94,
		roughness: 0.25,
		side: THREE.DoubleSide,
	});

	const gridFinMat = new THREE.MeshStandardMaterial({
		color: 0x6c737f,
		metalness: 0.9,
		roughness: 0.28,
	});

	const payloadFrameMat = new THREE.MeshStandardMaterial({
		color: 0xbac4d0,
		metalness: 0.88,
		roughness: 0.24,
	});

	const coreReactorMat = new THREE.MeshPhysicalMaterial({
		color: 0x7dd3fc,
		emissive: 0x0ea5e9,
		emissiveIntensity: 1.65,
		metalness: 0.8,
		roughness: 0.12,
		iridescence: 1.0,
		iridescenceIOR: 1.6,
		clearcoat: 1.0,
	});

	const fairingCompositeMat = new THREE.MeshPhysicalMaterial({
		color: 0xeef2f7,
		metalness: 0.35,
		roughness: 0.24,
		clearcoat: 0.65,
		clearcoatRoughness: 0.16,
		side: THREE.DoubleSide,
	});

	const solarArrayMat = new THREE.MeshPhysicalMaterial({
		color: 0x0a1936,
		emissive: 0x072348,
		emissiveIntensity: 0.45,
		metalness: 0.88,
		roughness: 0.14,
		clearcoat: 0.9,
	});

	const xrayHullMat = new THREE.MeshBasicMaterial({
		color: 0x38bdf8,
		wireframe: true,
		transparent: true,
		opacity: 0.22,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
	});

	interface HullEntry {
		mesh: THREE.Mesh;
		solidMat: THREE.Material;
	}
	const hullEntries: HullEntry[] = [];
	let coreReactorMesh: THREE.Object3D | null = null;

	// 3D Reference markers on the spacecraft for real-time 2D HUD callout tracking
	const markerPayload = new THREE.Object3D();
	markerPayload.position.set(0, 0.72, 0.42);
	upperStageGroup.add(markerPayload);

	const markerAvionics = new THREE.Object3D();
	markerAvionics.position.set(0.58, -0.18, 0.25);
	boosterGroup.add(markerAvionics);

	const markerPropulsion = new THREE.Object3D();
	markerPropulsion.position.set(0, -2.42, 0.38);
	boosterGroup.add(markerPropulsion);

	// Load authentic 10-part Orbital Craft `.glb`
	const loader = new GLTFLoader();
	loader.load(
		'/models/orbital-craft.glb',
		(gltf) => {
			const children = [...gltf.scene.children];
			for (const obj of children) {
				const mesh = obj as THREE.Mesh;
				if (!mesh.isMesh) continue;

				switch (mesh.name) {
					case 'BoosterStage':
						mesh.material = stainlessMat;
						hullEntries.push({ mesh, solidMat: stainlessMat });
						boosterGroup.add(mesh);
						break;
					case 'HeatShieldBelly':
						mesh.material = tpsTileMat;
						hullEntries.push({ mesh, solidMat: tpsTileMat });
						boosterGroup.add(mesh);
						break;
					case 'EngineBellCluster':
						mesh.material = engineNozzleMat;
						hullEntries.push({ mesh, solidMat: engineNozzleMat });
						boosterGroup.add(mesh);
						break;
					case 'InterstageGridFins':
						mesh.material = gridFinMat;
						hullEntries.push({ mesh, solidMat: gridFinMat });
						boosterGroup.add(mesh);
						break;
					case 'PayloadBayFrame':
						mesh.material = payloadFrameMat;
						hullEntries.push({ mesh, solidMat: payloadFrameMat });
						upperStageGroup.add(mesh);
						break;
					case 'PayloadCoreReactor':
						mesh.material = coreReactorMat;
						coreReactorMesh = mesh;
						upperStageGroup.add(mesh);
						break;
					case 'FairingPort':
						mesh.material = fairingCompositeMat;
						hullEntries.push({ mesh, solidMat: fairingCompositeMat });
						fairingPortPivot.add(mesh);
						break;
					case 'FairingStarboard':
						mesh.material = fairingCompositeMat;
						hullEntries.push({ mesh, solidMat: fairingCompositeMat });
						fairingStarboardPivot.add(mesh);
						break;
					case 'SolarWingPort':
						mesh.material = solarArrayMat;
						hullEntries.push({ mesh, solidMat: solarArrayMat });
						wingPortPivot.add(mesh);
						break;
					case 'SolarWingStarboard':
						mesh.material = solarArrayMat;
						hullEntries.push({ mesh, solidMat: solarArrayMat });
						wingStarboardPivot.add(mesh);
						break;
					default:
						craftGimbal.add(mesh);
				}
			}

			root.dataset.modelLoaded = 'true';
			document.querySelectorAll<HTMLElement>('[data-stage-status]').forEach((el) => {
				el.textContent = 'TELEMETRY NOMINAL // GLB ONLINE';
			});
		},
		undefined,
		() => {
			root.classList.add('webgl-fallback');
		}
	);

	// Flight Control State
	let manualOverride = false;
	let activeMode: FlightMode = 'orbit';
	let stageSeparated = false;

	let fairingOpenAmt = 0;
	let stageSepAmt = 0;
	let wingDeployAmt = 1;
	let throttleAmt = 0;
	let scrollProgress = 0;

	let userRotX = 0;
	let userRotY = 0;
	let velRotX = 0;
	let velRotY = 0;
	let isDragging = false;
	let lastDragX = 0;
	let lastDragY = 0;
	let pointerX = 0;
	let pointerY = 0;
	let smoothPointerX = 0;
	let smoothPointerY = 0;

	const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-flight-mode]'));
	const sepButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-stage-sep]'));
	const statusReadout = document.querySelector<HTMLElement>('[data-flight-caption]');
	const altReadout = document.querySelector<HTMLElement>('[data-telemetry-alt]');
	const velReadout = document.querySelector<HTMLElement>('[data-telemetry-vel]');
	const attReadout = document.querySelector<HTMLElement>('[data-telemetry-att]');

	const calloutPayload = document.querySelector<HTMLElement>('[data-callout="payload"]');
	const calloutAvionics = document.querySelector<HTMLElement>('[data-callout="avionics"]');
	const calloutPropulsion = document.querySelector<HTMLElement>('[data-callout="propulsion"]');

	const MODE_CAPTIONS: Record<FlightMode, string> = {
		orbit: 'LEO ORBITAL CRUISE // 地球低軌道巡航・姿勢制御中',
		payload: 'FAIRING DEPLOYED // ナノ粒子合成リアクターモジュール展開',
		burn: '7x VECTOR IGNITION // 軌道遷移メインエンジン噴射テスト',
		xray: 'CAD STRUCTURAL X-RAY // 内部構造・推進系ワイヤースキャン',
	};

	const setXrayMaterials = (enabled: boolean) => {
		for (const item of hullEntries) {
			item.mesh.material = enabled ? xrayHullMat : item.solidMat;
		}
	};

	const syncUiButtons = () => {
		for (const btn of modeButtons) {
			const current = btn.dataset.flightMode === activeMode;
			btn.classList.toggle('is-active', current);
			btn.setAttribute('aria-pressed', String(current));
		}
		for (const btn of sepButtons) {
			btn.classList.toggle('is-active', stageSeparated);
			btn.setAttribute('aria-pressed', String(stageSeparated));
		}
		if (statusReadout) {
			statusReadout.textContent = MODE_CAPTIONS[activeMode];
		}
	};

	const applyFlightMode = (mode: FlightMode, fromUser = true) => {
		if (fromUser) manualOverride = true;
		activeMode = mode;
		setXrayMaterials(mode === 'xray');
		if (mode === 'payload') {
			// Ensure fairings open in payload mode
			velRotY += 0.015;
		} else if (mode === 'burn') {
			velRotY -= 0.02;
		}
		syncUiButtons();
	};

	const toggleStageSep = (next?: boolean) => {
		manualOverride = true;
		stageSeparated = typeof next === 'boolean' ? next : !stageSeparated;
		syncUiButtons();
	};

	for (const btn of modeButtons) {
		btn.addEventListener('click', () => {
			const m = btn.dataset.flightMode as FlightMode | undefined;
			if (m) applyFlightMode(m, true);
		});
	}

	for (const btn of sepButtons) {
		btn.addEventListener('click', () => toggleStageSep());
	}

	const onKeyDown = (e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		if (e.key === '1') applyFlightMode('orbit', true);
		else if (e.key === '2') applyFlightMode('payload', true);
		else if (e.key === '3') applyFlightMode('burn', true);
		else if (e.key === '4') applyFlightMode('xray', true);
		else if (e.key === 's' || e.key === 'S' || e.key === 'e' || e.key === 'E') toggleStageSep();
	};
	window.addEventListener('keydown', onKeyDown);

	// Pointer parallax + interactive drag zones
	const onPointerMoveWin = (e: PointerEvent) => {
		pointerX = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
		pointerY = -((e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1);
	};
	window.addEventListener('pointermove', onPointerMoveWin, { passive: true });

	const dragZones = Array.from(document.querySelectorAll<HTMLElement>('[data-orbital-drag]'));
	const dragCleanups: Array<() => void> = [];

	for (const zone of dragZones) {
		const down = (e: PointerEvent) => {
			// Ignore clicks on buttons/links inside hero
			if ((e.target as HTMLElement | null)?.closest('button, a')) return;
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
			velRotY = dx * 0.0068;
			velRotX = dy * 0.0055;
			userRotY += velRotY;
			userRotX = THREE.MathUtils.clamp(userRotX + velRotX, -1.15, 1.15);
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

		dragCleanups.push(() => {
			zone.removeEventListener('pointerdown', down);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		});
	}

	const updateScroll = () => {
		const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
		scrollProgress = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);

		// Automatic SpaceX mission choreography while scrolling if user hasn't locked manual mode
		if (variant === 'home' && !manualOverride) {
			let nextMode: FlightMode = 'orbit';
			if (scrollProgress >= 0.18 && scrollProgress < 0.5) {
				nextMode = 'payload';
			} else if (scrollProgress >= 0.5 && scrollProgress < 0.78) {
				nextMode = 'burn';
			} else {
				nextMode = 'orbit';
			}
			if (nextMode !== activeMode) {
				applyFlightMode(nextMode, false);
			}
		}
	};
	window.addEventListener('scroll', updateScroll, { passive: true });

	let viewportW = window.innerWidth;
	let viewportH = window.innerHeight;
	let isMobile = viewportW < 860;

	const updateSize = () => {
		const rect = root.getBoundingClientRect();
		viewportW = Math.max(rect.width || window.innerWidth, 1);
		viewportH = Math.max(rect.height || window.innerHeight, 1);
		isMobile = viewportW < 860;

		camera.aspect = viewportW / viewportH;
		camera.fov = isMobile ? 44 : 36;
		camera.updateProjectionMatrix();

		renderer.setSize(viewportW, viewportH, false);
		composer.setSize(viewportW, viewportH);
		bloomPass.resolution.set(viewportW, viewportH);
	};
	window.addEventListener('resize', updateSize);
	updateSize();
	updateScroll();

	const tmpProj = new THREE.Vector3();
	const projectCallout = (
		marker: THREE.Object3D,
		el: HTMLElement | null,
		visibleInHero: boolean
	) => {
		if (!el) return;
		if (!visibleInHero || isMobile) {
			el.style.opacity = '0';
			return;
		}
		marker.getWorldPosition(tmpProj);
		tmpProj.project(camera);
		if (tmpProj.z > 1 || tmpProj.x < -0.95 || tmpProj.x > 0.95 || tmpProj.y < -0.9 || tmpProj.y > 0.9) {
			el.style.opacity = '0';
			return;
		}
		const sx = (tmpProj.x * 0.5 + 0.5) * viewportW;
		const sy = (-tmpProj.y * 0.5 + 0.5) * viewportH;
		const flipLeft = sx > viewportW * 0.72;
		el.classList.toggle('is-flipped', flipLeft);
		el.style.transform = flipLeft
			? `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translateX(-100%)`
			: `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
		el.style.opacity = '1';
	};

	let rafId = 0;
	let pageVisible = true;
	const clock = new THREE.Clock();

	const onVis = () => {
		pageVisible = !document.hidden;
		if (pageVisible) clock.getDelta();
	};
	document.addEventListener('visibilitychange', onVis);

	const animate = () => {
		rafId = window.requestAnimationFrame(animate);
		if (!pageVisible) return;

		const dt = Math.min(clock.getDelta(), 0.05);
		const elapsed = clock.elapsedTime;
		const lerpFast = 1 - Math.pow(0.03, dt);

		smoothPointerX += (pointerX - smoothPointerX) * 0.05;
		smoothPointerY += (pointerY - smoothPointerY) * 0.05;

		if (!isDragging) {
			velRotX *= 0.93;
			velRotY *= 0.93;
			userRotX = THREE.MathUtils.clamp(userRotX + velRotX, -1.15, 1.15);
			userRotY += velRotY;
		}

		// Target mechanical states based on FlightMode + StageSep
		const wantFairingOpen = activeMode === 'payload' || stageSeparated ? 1.0 : 0.0;
		const wantStageSep = stageSeparated ? 1.0 : 0.0;
		const wantThrottle = activeMode === 'burn' ? 1.0 : 0.0;
		const wantWings = 1.0;

		fairingOpenAmt += (wantFairingOpen - fairingOpenAmt) * lerpFast;
		stageSepAmt += (wantStageSep - stageSepAmt) * lerpFast;
		throttleAmt += (wantThrottle - throttleAmt) * (1 - Math.pow(0.008, dt));
		wingDeployAmt += (wantWings - wingDeployAmt) * lerpFast;

		// Articulate Clamshell Fairings (Port -X & Starboard +X)
		fairingPortPivot.position.x = -fairingOpenAmt * 0.68;
		fairingPortPivot.position.y = fairingOpenAmt * 0.08;
		fairingPortPivot.rotation.z = fairingOpenAmt * 0.34;

		fairingStarboardPivot.position.x = fairingOpenAmt * 0.68;
		fairingStarboardPivot.position.y = fairingOpenAmt * 0.08;
		fairingStarboardPivot.rotation.z = -fairingOpenAmt * 0.34;

		// Articulate Booster / Upper Stage separation
		boosterGroup.position.y = -stageSepAmt * 0.52;
		upperStageGroup.position.y = stageSepAmt * 0.42;

		// Solar wing subtle tracking
		wingPortPivot.rotation.x = Math.sin(elapsed * 0.35) * 0.06 * wingDeployAmt;
		wingStarboardPivot.rotation.x = Math.sin(elapsed * 0.35) * 0.06 * wingDeployAmt;

		// Spin internal NanoFrontier Core Reactor & modulate glow
		if (coreReactorMesh && !reducedMotion) {
			coreReactorMesh.rotation.y = elapsed * 0.95;
			coreReactorMesh.rotation.x = Math.sin(elapsed * 0.6) * 0.35;
		}
		reactorLight.intensity = 2.2 + fairingOpenAmt * 5.5;

		// Rocket Plume & Engine Bell Incandescence
		plumeUniforms.uTime.value = elapsed;
		plumeUniforms.uThrottle.value = throttleAmt;
		outerPlume.visible = throttleAmt > 0.01;
		innerPlume.visible = throttleAmt > 0.01;
		engineNozzleMat.emissiveIntensity = throttleAmt * 2.4;
		engineBurnLight.intensity = throttleAmt * 14.0 * (0.92 + 0.08 * Math.sin(elapsed * 65.0));

		// Camera & Craft Spatial Choreography across scroll
		if (variant === 'home') {
			const targetX = isMobile
				? 0.05
				: scrollProgress < 0.16
					? 1.48
					: THREE.MathUtils.lerp(1.48, 1.15, Math.min(1, (scrollProgress - 0.16) * 3));
			const targetY = isMobile
				? THREE.MathUtils.lerp(1.02, 0.15, Math.min(1, scrollProgress * 2.6))
				: THREE.MathUtils.lerp(0.18, -0.05, scrollProgress);
			const modeZoom =
				activeMode === 'payload' ? 0.85 : activeMode === 'burn' ? 0.35 : 0.0;
			const targetZ = (isMobile ? 0.85 : 0.35) + modeZoom * (isMobile ? 0.55 : 1.0);

			craftAnchor.position.x += (targetX - craftAnchor.position.x) * 0.08;
			craftAnchor.position.y += (targetY - craftAnchor.position.y) * 0.08;
			craftAnchor.position.z += (targetZ - craftAnchor.position.z) * 0.08;

			const mobileScale = isMobile ? 0.82 : 1.0;
			craftGimbal.scale.setScalar(mobileScale);

			// Base attitude shifts subtly per flight mode so engine bells or payload bay face camera clearly
			const modePitch =
				activeMode === 'payload'
					? 0.42
					: activeMode === 'burn'
						? -0.22
						: 0.28;
			const modeRoll = activeMode === 'burn' ? -0.78 : isMobile ? -0.68 : -0.52;

			const slowRoll = reducedMotion ? 0 : elapsed * 0.11;
			craftGimbal.rotation.x +=
				(modePitch + userRotX - smoothPointerY * 0.16 - craftGimbal.rotation.x) * 0.09;
			craftGimbal.rotation.y =
				-0.55 + slowRoll + userRotY + scrollProgress * 1.35 + smoothPointerX * 0.22;
			craftGimbal.rotation.z += (modeRoll - craftGimbal.rotation.z) * 0.07;

			// Earth horizon slow orbital rotation + altitude parallax
			if (!reducedMotion) {
				planetUniforms.uTime.value = elapsed;
				planetMesh.rotation.y = elapsed * 0.018 + scrollProgress * 0.35;
				stars.rotation.y = elapsed * 0.004;
			}
			const baseEarthY = isMobile ? -17.35 : -16.05;
			earthGroup.position.x = isMobile ? 0 : -1.2;
			earthGroup.position.y = baseEarthY - scrollProgress * 1.15 + smoothPointerY * 0.18;
		} else {
			// Compact header stage on About page
			const targetX = isMobile ? 0.05 : 1.55;
			const targetY = isMobile ? 0.72 : 0.08;
			const targetZ = isMobile ? 0.65 : 0.45;
			craftAnchor.position.x += (targetX - craftAnchor.position.x) * 0.1;
			craftAnchor.position.y += (targetY - craftAnchor.position.y) * 0.1;
			craftAnchor.position.z += (targetZ - craftAnchor.position.z) * 0.1;
			craftGimbal.scale.setScalar(isMobile ? 0.78 : 1.0);

			const slowRoll = reducedMotion ? 0 : elapsed * 0.14;
			craftGimbal.rotation.x = 0.3 + userRotX - smoothPointerY * 0.14;
			craftGimbal.rotation.y = -0.5 + slowRoll + userRotY + smoothPointerX * 0.2;
			craftGimbal.rotation.z = isMobile ? -0.65 : -0.48;
			earthGroup.position.x = isMobile ? 0 : -1.2;
			earthGroup.position.y = isMobile ? -17.35 : -16.05;

			if (!reducedMotion) {
				planetUniforms.uTime.value = elapsed;
				planetMesh.rotation.y = elapsed * 0.018;
			}
		}

		// Live SpaceX Mission Telemetry Readouts
		if (altReadout) {
			const alt = 418.2 + Math.sin(elapsed * 0.32) * 0.6 + scrollProgress * 14.4;
			altReadout.textContent = `${alt.toFixed(1)} KM`;
		}
		if (velReadout) {
			const vel = 27614 + Math.round(throttleAmt * 420 + Math.sin(elapsed * 1.7) * 6);
			velReadout.textContent = `${vel.toLocaleString('en-US')} KM/H`;
		}
		if (attReadout) {
			const yaw = (((craftGimbal.rotation.y * 180) / Math.PI) % 360 + 360) % 360;
			const pitch = (craftGimbal.rotation.x * 180) / Math.PI;
			attReadout.textContent = `P ${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}° / Y ${yaw.toFixed(0).padStart(3, '0')}°`;
		}

		// Update 3D→2D leader callouts when near Hero top
		const showCallouts = variant === 'home' && scrollProgress < 0.14 && root.dataset.modelLoaded === 'true';
		projectCallout(markerPayload, calloutPayload, showCallouts);
		projectCallout(markerAvionics, calloutAvionics, showCallouts);
		projectCallout(markerPropulsion, calloutPropulsion, showCallouts);

		composer.render();
	};

	syncUiButtons();
	animate();

	return () => {
		window.cancelAnimationFrame(rafId);
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('pointermove', onPointerMoveWin);
		window.removeEventListener('scroll', updateScroll);
		window.removeEventListener('resize', updateSize);
		document.removeEventListener('visibilitychange', onVis);
		for (const fn of dragCleanups) fn();
		planetGeo.dispose();
		planetMat.dispose();
		atmoGeo.dispose();
		atmoMat.dispose();
		outerPlumeGeo.dispose();
		innerPlumeGeo.dispose();
		plumeMat.dispose();
		arcGeo.dispose();
		arcMat.dispose();
		envRT.dispose();
		composer.dispose();
		renderer.dispose();
	};
}
