import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function cleanNonIdx(geo) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	g.computeVertexNormals();
	return g;
}

function cleanIndexed(geo, smoothNormals = true) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	if (smoothNormals) {
		g.deleteAttribute('normal');
		const indexed = mergeVertices(g, 1e-4);
		indexed.computeVertexNormals();
		return indexed;
	}
	g.computeVertexNormals();
	return mergeVertices(g, 1e-4);
}

/** 1. Main Stainless/Titanium Booster Hull + Raceways + Circumferential Weld Rings */
function buildBoosterStage() {
	const parts = [];

	// Main tank cylinder (y: -2.15 .. -0.15)
	const hull = cleanNonIdx(new THREE.CylinderGeometry(0.56, 0.58, 2.0, 48, 4, false));
	hull.translate(0, -1.15, 0);
	parts.push(hull);

	// Aft skirt flare
	const skirt = cleanNonIdx(new THREE.CylinderGeometry(0.58, 0.62, 0.28, 48, 1, true));
	skirt.translate(0, -2.18, 0);
	parts.push(skirt);

	// Aft thrust dome bulkhead
	const dome = cleanNonIdx(
		new THREE.SphereGeometry(0.56, 32, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5)
	);
	dome.scale(1, 0.35, 1);
	dome.translate(0, -2.12, 0);
	parts.push(dome);

	// 5 precision weld/stiffener rings
	const ringHeights = [-0.2, -0.65, -1.15, -1.65, -2.06];
	for (const y of ringHeights) {
		const ring = cleanNonIdx(new THREE.TorusGeometry(0.578, 0.014, 8, 56));
		ring.rotateX(Math.PI * 0.5);
		ring.translate(0, y, 0);
		parts.push(ring);
	}

	// 12 vertical stringer flutes + 2 prominent avionics raceway conduits
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2;
		const isRaceway = i === 0 || i === 6;
		const w = isRaceway ? 0.075 : 0.018;
		const d = isRaceway ? 0.055 : 0.016;
		const rib = cleanNonIdx(new THREE.BoxGeometry(w, 1.92, d));
		rib.rotateY(-angle);
		const r = 0.572 + d * 0.35;
		rib.translate(Math.sin(angle) * r, -1.15, Math.cos(angle) * r);
		parts.push(rib);
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 2. Windward Ceramic Thermal Protection System (TPS) Heat-Shield Shell */
function buildHeatShieldBelly() {
	const parts = [];
	const shield = cleanNonIdx(
		new THREE.CylinderGeometry(0.592, 0.612, 1.94, 32, 8, true, -Math.PI * 0.42, Math.PI * 0.84)
	);
	shield.rotateY(Math.PI); // place on -Z belly
	shield.translate(0, -1.15, 0);
	parts.push(shield);

	// Segmented TPS tile bands
	for (let row = 0; row < 7; row++) {
		const y = -1.92 + row * 0.26;
		const band = cleanNonIdx(
			new THREE.TorusGeometry(0.604, 0.008, 6, 32, Math.PI * 0.82)
		);
		band.rotateX(Math.PI * 0.5);
		band.rotateY(-Math.PI * 0.91);
		band.translate(0, y, 0);
		parts.push(band);
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 3. 7-Engine Raptor-style Parabolic Rocket Bell Cluster */
function buildEngineBellCluster() {
	const parts = [];

	// Parabolic bell contour (Rao nozzle profile)
	const profile = [];
	const steps = 14;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const y = -t * 0.42;
		// Throat at t=0.15, parabolic expansion to exit
		const r =
			t < 0.18
				? 0.055 - Math.sin((t / 0.18) * Math.PI * 0.5) * 0.016
				: 0.039 + Math.pow((t - 0.18) / 0.82, 0.68) * 0.108;
		profile.push(new THREE.Vector2(r, y));
	}

	const makeEngine = (x, z, tiltX = 0, tiltZ = 0, scale = 1) => {
		const bell = cleanNonIdx(new THREE.LatheGeometry(profile, 24));
		bell.scale(scale, scale, scale);

		// Cooling manifold rings around nozzle
		const hoop1 = cleanNonIdx(new THREE.TorusGeometry(0.095 * scale, 0.007 * scale, 6, 20));
		hoop1.rotateX(Math.PI * 0.5);
		hoop1.translate(0, -0.18 * scale, 0);

		const hoop2 = cleanNonIdx(new THREE.TorusGeometry(0.132 * scale, 0.008 * scale, 6, 20));
		hoop2.rotateX(Math.PI * 0.5);
		hoop2.translate(0, -0.34 * scale, 0);

		// Powerhead / turbopump cylinder
		const pump = cleanNonIdx(new THREE.CylinderGeometry(0.058 * scale, 0.052 * scale, 0.14 * scale, 14));
		pump.translate(0, 0.06 * scale, 0);

		const unit = mergeGeometries([bell, hoop1, hoop2, pump], false);
		unit.rotateX(tiltX);
		unit.rotateZ(tiltZ);
		unit.translate(x, -2.22, z);
		return unit;
	};

	// Center vacuum/sea-level gimbal engine
	parts.push(makeEngine(0, 0, 0, 0, 1.08));

	// 6 outer ring engines
	const ringRadius = 0.34;
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		const x = Math.cos(a) * ringRadius;
		const z = Math.sin(a) * ringRadius;
		parts.push(makeEngine(x, z, Math.sin(a) * 0.045, -Math.cos(a) * 0.045, 0.94));
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 4. SpaceX-style Deployable Lattice Grid Fins + Cold-Gas RCS Pods */
function buildInterstageGridFins() {
	const parts = [];

	// Interstage collar ring
	const collar = cleanNonIdx(new THREE.CylinderGeometry(0.575, 0.575, 0.22, 48, 1, true));
	collar.translate(0, -0.16, 0);
	parts.push(collar);

	// 4 Waffle Grid Fins at 45°, 135°, 225°, 315°
	for (let f = 0; f < 4; f++) {
		const angle = (f / 4) * Math.PI * 2 + Math.PI * 0.25;
		const finParts = [];

		const span = 0.34;
		const chord = 0.24;
		const thick = 0.032;

		// Outer titanium box frame
		const sideL = cleanNonIdx(new THREE.BoxGeometry(span, thick, 0.014));
		sideL.translate(span * 0.5, 0, chord * 0.5);
		const sideR = cleanNonIdx(new THREE.BoxGeometry(span, thick, 0.014));
		sideR.translate(span * 0.5, 0, -chord * 0.5);
		const tip = cleanNonIdx(new THREE.BoxGeometry(0.016, thick, chord));
		tip.translate(span, 0, 0);
		const rootMount = cleanNonIdx(new THREE.BoxGeometry(0.08, 0.08, 0.09));
		rootMount.translate(0.02, 0, 0);
		finParts.push(sideL, sideR, tip, rootMount);

		// Internal waffle lattice vanes
		for (let i = 1; i <= 4; i++) {
			const xPos = (i / 5) * span;
			const rib = cleanNonIdx(new THREE.BoxGeometry(0.009, thick * 0.88, chord));
			rib.translate(xPos, 0, 0);
			finParts.push(rib);
		}
		for (let j = -1; j <= 1; j++) {
			const zPos = j * (chord * 0.28);
			const spar = cleanNonIdx(new THREE.BoxGeometry(span, thick * 0.88, 0.009));
			spar.translate(span * 0.5, 0, zPos);
			finParts.push(spar);
		}

		const fin = mergeGeometries(finParts, false);
		fin.rotateY(-angle);
		fin.translate(Math.cos(angle) * 0.57, -0.18, Math.sin(angle) * 0.57);
		parts.push(fin);
	}

	// 4 RCS thruster pods at 0°, 90°, 180°, 270°
	for (let r = 0; r < 4; r++) {
		const angle = (r / 4) * Math.PI * 2;
		const pod = cleanNonIdx(new THREE.BoxGeometry(0.06, 0.14, 0.09));
		pod.rotateY(-angle);
		pod.translate(Math.sin(angle) * 0.59, -0.16, Math.cos(angle) * 0.59);
		parts.push(pod);
	}

	return cleanIndexed(mergeGeometries(parts, false), false);
}

/** 5. Upper Stage Payload Bay Frame + Forward Docking Collar */
function buildPayloadBayFrame() {
	const parts = [];

	// Payload adapter base plate
	const base = cleanNonIdx(new THREE.CylinderGeometry(0.52, 0.56, 0.16, 40));
	base.translate(0, -0.02, 0);
	parts.push(base);

	// Central spine & 4 slim structural longerons holding forward docking ring
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
		const strut = cleanNonIdx(new THREE.CylinderGeometry(0.016, 0.016, 1.18, 8));
		strut.translate(Math.cos(a) * 0.42, 0.58, Math.sin(a) * 0.42);
		parts.push(strut);
	}

	// Upper telemetry & docking sensor ring
	const upperRing = cleanNonIdx(new THREE.TorusGeometry(0.42, 0.022, 10, 40));
	upperRing.rotateX(Math.PI * 0.5);
	upperRing.translate(0, 1.16, 0);
	parts.push(upperRing);

	// 6 optical lidar docking latches on upper ring
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		const latch = cleanNonIdx(new THREE.BoxGeometry(0.04, 0.05, 0.04));
		latch.rotateY(-a);
		latch.translate(Math.sin(a) * 0.42, 1.19, Math.cos(a) * 0.42);
		parts.push(latch);
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 6. Internal NanoFrontier Synthesis Core Reactor (Revealed on Fairing Separation) */
function buildPayloadCoreReactor() {
	const parts = [];

	// Faceted harmonic nano-crystal core
	const core = cleanNonIdx(new THREE.IcosahedronGeometry(0.28, 2));
	const pos = core.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const d = v.clone().normalize();
		const mod = 1 + Math.sin(d.x * 8) * Math.cos(d.y * 8) * Math.sin(d.z * 8) * 0.12;
		v.copy(d).multiplyScalar(0.27 * mod);
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	core.computeVertexNormals();
	core.translate(0, 0.58, 0);
	parts.push(core);

	// 3 Orthogonal magnetic confinement coils
	for (let i = 0; i < 3; i++) {
		const coil = cleanNonIdx(new THREE.TorusGeometry(0.36 + i * 0.025, 0.012, 10, 48));
		coil.rotateX((i * Math.PI) / 3 + 0.35);
		coil.rotateY((i * Math.PI) / 4);
		coil.translate(0, 0.58, 0);
		parts.push(coil);
	}

	// Dodecahedral molecular node vertices around core
	const cage = new THREE.DodecahedronGeometry(0.34, 0);
	const cPos = cage.attributes.position;
	const uniq = [];
	for (let i = 0; i < cPos.count; i++) {
		const p = new THREE.Vector3().fromBufferAttribute(cPos, i);
		if (!uniq.some((u) => u.distanceTo(p) < 1e-3)) uniq.push(p);
	}
	for (const u of uniq) {
		const atom = cleanNonIdx(new THREE.OctahedronGeometry(0.026, 0));
		atom.translate(u.x, u.y + 0.58, u.z);
		parts.push(atom);
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 7 & 8. Tangent-Ogive Aerodynamic Clamshell Fairings (Port -X & Starboard +X) */
function buildFairingHalf(side /* -1 = Port (-X), +1 = Starboard (+X) */) {
	const parts = [];

	// Tangent ogive profile from y = -0.05 to y = +2.18
	const profile = [];
	const steps = 26;
	const height = 2.22;
	const baseR = 0.575;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const y = -0.04 + t * height;
		// Smooth aerodynamic Haack/Von Karman nosecone curve
		const theta = Math.acos(1 - 2 * t);
		const r =
			t < 0.25
				? baseR
				: baseR *
					Math.sqrt(
						Math.max(
							0.002,
							(Math.PI - (theta - Math.sin(2 * theta) * 0.5)) / Math.PI
						)
					);
		profile.push(new THREE.Vector2(i === steps ? 0.001 : r, y));
	}

	// Outer skin shell (half revolution)
	const phiStart = side < 0 ? Math.PI : 0;
	const outerShell = cleanNonIdx(
		new THREE.LatheGeometry(profile, 28, phiStart, Math.PI)
	);
	parts.push(outerShell);

	// Inner skin shell (slightly inset for solid aerospace wall thickness)
	const innerProfile = profile.map(
		(pt, idx) => new THREE.Vector2(Math.max(0.001, pt.x - (idx === steps ? 0 : 0.028)), pt.y - 0.01)
	);
	const innerShell = cleanNonIdx(
		new THREE.LatheGeometry(innerProfile.reverse(), 24, phiStart, Math.PI)
	);
	parts.push(innerShell);

	// 4 Internal acoustic/structural half-ring ribs visible when fairing opens
	const ribHeights = [0.22, 0.62, 1.04, 1.46];
	for (const ry of ribHeights) {
		const t = (ry + 0.04) / height;
		const sampleIdx = Math.min(steps, Math.max(0, Math.round(t * steps)));
		const rad = Math.max(0.08, profile[sampleIdx].x - 0.025);
		const rib = cleanNonIdx(
			new THREE.TorusGeometry(rad, 0.015, 6, 20, Math.PI)
		);
		rib.rotateX(Math.PI * 0.5);
		if (side < 0) {
			rib.rotateY(-Math.PI * 0.5);
		} else {
			rib.rotateY(Math.PI * 0.5);
		}
		rib.translate(0, ry, 0);
		parts.push(rib);
	}

	return cleanIndexed(mergeGeometries(parts, false), true);
}

/** 9 & 10. Deployable Orbital Solar / Radiator Wing Arrays (Port -X & Starboard +X) */
function buildSolarWing(side /* -1 or +1 */) {
	const parts = [];
	const dir = side;

	// Root gimbalboom
	const boom = cleanNonIdx(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8));
	boom.rotateZ(Math.PI * 0.5);
	boom.translate(dir * 0.76, -0.36, 0);
	parts.push(boom);

	// Central spine extending outward
	const spine = cleanNonIdx(new THREE.BoxGeometry(1.78, 0.028, 0.036));
	spine.translate(dir * 1.78, -0.36, 0);
	parts.push(spine);

	// 4 Segmented solar/radiator panels per wing
	for (let p = 0; p < 4; p++) {
		const px = dir * (1.06 + p * 0.46);
		const panel = cleanNonIdx(new THREE.BoxGeometry(0.41, 0.012, 0.62));
		panel.translate(px, -0.36, 0);
		parts.push(panel);

		// Frame edge bars
		const edgeF = cleanNonIdx(new THREE.BoxGeometry(0.42, 0.02, 0.016));
		edgeF.translate(px, -0.36, 0.31);
		const edgeB = cleanNonIdx(new THREE.BoxGeometry(0.42, 0.02, 0.016));
		edgeB.translate(px, -0.36, -0.31);
		parts.push(edgeF, edgeB);
	}

	return cleanIndexed(mergeGeometries(parts, false), false);
}

function packGlb(namedMeshes) {
	const bufferChunks = [];
	const bufferViews = [];
	const accessors = [];
	const meshes = [];
	const nodes = [];
	const materials = namedMeshes.map((m) => ({
		name: `${m.name}Mat`,
		pbrMetallicRoughness: {
			baseColorFactor: m.color,
			metallicFactor: m.metallic,
			roughnessFactor: m.roughness,
		},
		doubleSided: Boolean(m.doubleSided),
	}));

	let byteOffset = 0;

	const appendAligned = (typedArray) => {
		const raw = Buffer.from(
			typedArray.buffer,
			typedArray.byteOffset,
			typedArray.byteLength
		);
		const pad = (4 - (raw.length % 4)) % 4;
		const padded = pad > 0 ? Buffer.concat([raw, Buffer.alloc(pad)]) : raw;
		const offset = byteOffset;
		bufferChunks.push(padded);
		byteOffset += padded.length;
		return { offset, byteLength: raw.length };
	};

	namedMeshes.forEach((entry, idx) => {
		const geo = entry.geometry;
		if (!geo.attributes.normal) geo.computeVertexNormals();

		const posAttr = geo.attributes.position;
		const normAttr = geo.attributes.normal;
		const count = posAttr.count;

		const positions = new Float32Array(count * 3);
		const normals = new Float32Array(count * 3);
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];

		for (let i = 0; i < count; i++) {
			const x = posAttr.getX(i);
			const y = posAttr.getY(i);
			const z = posAttr.getZ(i);
			positions[i * 3] = x;
			positions[i * 3 + 1] = y;
			positions[i * 3 + 2] = z;
			if (x < min[0]) min[0] = x;
			if (y < min[1]) min[1] = y;
			if (z < min[2]) min[2] = z;
			if (x > max[0]) max[0] = x;
			if (y > max[1]) max[1] = y;
			if (z > max[2]) max[2] = z;

			normals[i * 3] = normAttr.getX(i);
			normals[i * 3 + 1] = normAttr.getY(i);
			normals[i * 3 + 2] = normAttr.getZ(i);
		}

		const posChunk = appendAligned(positions);
		const posViewIdx = bufferViews.length;
		bufferViews.push({
			buffer: 0,
			byteOffset: posChunk.offset,
			byteLength: posChunk.byteLength,
			target: 34962,
		});
		const posAccIdx = accessors.length;
		accessors.push({
			bufferView: posViewIdx,
			componentType: 5126,
			count,
			type: 'VEC3',
			min,
			max,
		});

		const normChunk = appendAligned(normals);
		const normViewIdx = bufferViews.length;
		bufferViews.push({
			buffer: 0,
			byteOffset: normChunk.offset,
			byteLength: normChunk.byteLength,
			target: 34962,
		});
		const normAccIdx = accessors.length;
		accessors.push({
			bufferView: normViewIdx,
			componentType: 5126,
			count,
			type: 'VEC3',
		});

		const primitive = {
			attributes: {
				POSITION: posAccIdx,
				NORMAL: normAccIdx,
			},
			material: idx,
			mode: 4,
		};

		if (geo.index) {
			const idxArray =
				count > 65535
					? new Uint32Array(geo.index.array)
					: new Uint16Array(geo.index.array);
			const idxChunk = appendAligned(idxArray);
			const idxViewIdx = bufferViews.length;
			bufferViews.push({
				buffer: 0,
				byteOffset: idxChunk.offset,
				byteLength: idxChunk.byteLength,
				target: 34963,
			});
			const idxAccIdx = accessors.length;
			accessors.push({
				bufferView: idxViewIdx,
				componentType: count > 65535 ? 5125 : 5123,
				count: idxArray.length,
				type: 'SCALAR',
			});
			primitive.indices = idxAccIdx;
		}

		meshes.push({
			name: entry.name,
			primitives: [primitive],
		});

		nodes.push({
			name: entry.name,
			mesh: idx,
		});
	});

	const binBuffer = Buffer.concat(bufferChunks);

	const gltf = {
		asset: {
			version: '2.0',
			generator: 'saikattyo-orbital-craft-builder',
		},
		scene: 0,
		scenes: [
			{
				name: 'SaikattyoOrbitalCraft',
				nodes: nodes.map((_, i) => i),
			},
		],
		nodes,
		meshes,
		materials,
		accessors,
		bufferViews,
		buffers: [{ byteLength: binBuffer.length }],
	};

	const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
	const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
	const jsonChunkData =
		jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

	const totalLength = 12 + 8 + jsonChunkData.length + 8 + binBuffer.length;
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(totalLength, 8);

	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonChunkData.length, 0);
	jsonHeader.writeUInt32LE(0x4e4f534a, 4);

	const binHeader = Buffer.alloc(8);
	binHeader.writeUInt32LE(binBuffer.length, 0);
	binHeader.writeUInt32LE(0x004e4942, 4);

	return Buffer.concat([header, jsonHeader, jsonChunkData, binHeader, binBuffer]);
}

const outDir = path.resolve('public/models');
fs.mkdirSync(outDir, { recursive: true });

const glb = packGlb([
	{
		name: 'BoosterStage',
		geometry: buildBoosterStage(),
		color: [0.84, 0.87, 0.91, 1.0],
		metallic: 0.92,
		roughness: 0.2,
	},
	{
		name: 'HeatShieldBelly',
		geometry: buildHeatShieldBelly(),
		color: [0.08, 0.09, 0.11, 1.0],
		metallic: 0.25,
		roughness: 0.72,
		doubleSided: true,
	},
	{
		name: 'EngineBellCluster',
		geometry: buildEngineBellCluster(),
		color: [0.34, 0.36, 0.4, 1.0],
		metallic: 0.94,
		roughness: 0.26,
		doubleSided: true,
	},
	{
		name: 'InterstageGridFins',
		geometry: buildInterstageGridFins(),
		color: [0.52, 0.55, 0.6, 1.0],
		metallic: 0.88,
		roughness: 0.3,
	},
	{
		name: 'PayloadBayFrame',
		geometry: buildPayloadBayFrame(),
		color: [0.76, 0.8, 0.85, 1.0],
		metallic: 0.88,
		roughness: 0.24,
	},
	{
		name: 'PayloadCoreReactor',
		geometry: buildPayloadCoreReactor(),
		color: [0.28, 0.78, 1.0, 1.0],
		metallic: 0.85,
		roughness: 0.14,
	},
	{
		name: 'FairingPort',
		geometry: buildFairingHalf(-1),
		color: [0.92, 0.94, 0.97, 1.0],
		metallic: 0.55,
		roughness: 0.24,
		doubleSided: true,
	},
	{
		name: 'FairingStarboard',
		geometry: buildFairingHalf(1),
		color: [0.92, 0.94, 0.97, 1.0],
		metallic: 0.55,
		roughness: 0.24,
		doubleSided: true,
	},
	{
		name: 'SolarWingPort',
		geometry: buildSolarWing(-1),
		color: [0.09, 0.16, 0.32, 1.0],
		metallic: 0.82,
		roughness: 0.18,
	},
	{
		name: 'SolarWingStarboard',
		geometry: buildSolarWing(1),
		color: [0.09, 0.16, 0.32, 1.0],
		metallic: 0.82,
		roughness: 0.18,
	},
]);

const outPath = path.join(outDir, 'orbital-craft.glb');
fs.writeFileSync(outPath, glb);
// Remove old nano-assembly.glb so repo stays clean
const oldPath = path.join(outDir, 'nano-assembly.glb');
if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

console.log(`Generated ${outPath} (${(glb.length / 1024).toFixed(1)} KB)`);
