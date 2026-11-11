import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function toNonIdx(geo) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	g.computeVertexNormals();
	return g;
}

function toIndexed(geo, smooth = true) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	if (smooth) {
		g.deleteAttribute('normal');
		const merged = mergeVertices(g, 1e-4);
		merged.computeVertexNormals();
		return merged;
	}
	g.computeVertexNormals();
	return mergeVertices(g, 1e-4);
}

/* ============================================================================
 * EDITION 01: NANO-DISPERSION (NanoFrontier — Fullerene Cage & Nano Cluster)
 * ========================================================================== */
function buildNanoCore() {
	const geo = new THREE.SphereGeometry(0.74, 72, 54);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const d = v.clone().normalize();
		const wave =
			Math.sin(d.x * 6.0) * Math.cos(d.y * 6.0) * Math.sin(d.z * 6.0) * 0.11 +
			Math.cos((d.x + d.z) * 10.0) * 0.025;
		v.copy(d).multiplyScalar(0.74 * (1 + wave));
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	return toIndexed(geo, true);
}

function buildNanoCage() {
	const base = new THREE.IcosahedronGeometry(1.42, 1);
	const pos = base.attributes.position;
	const verts = [];
	for (let i = 0; i < pos.count; i++) {
		const p = new THREE.Vector3().fromBufferAttribute(pos, i);
		if (!verts.some((u) => u.distanceTo(p) < 1e-3)) verts.push(p);
	}

	const parts = [];
	for (const v of verts) {
		const node = toNonIdx(new THREE.IcosahedronGeometry(0.052, 1));
		node.translate(v.x, v.y, v.z);
		parts.push(node);
	}

	const pairs = [];
	for (let i = 0; i < verts.length; i++) {
		for (let j = i + 1; j < verts.length; j++) {
			pairs.push({ i, j, d: verts[i].distanceTo(verts[j]) });
		}
	}
	pairs.sort((a, b) => a.d - b.d);
	const cutoff = pairs[0].d * 1.18;
	const up = new THREE.Vector3(0, 1, 0);

	for (const pr of pairs) {
		if (pr.d > cutoff) break;
		const a = verts[pr.i];
		const b = verts[pr.j];
		const mid = a.clone().add(b).multiplyScalar(0.5);
		const delta = b.clone().sub(a);
		const strut = toNonIdx(
			new THREE.CylinderGeometry(0.013, 0.013, delta.length(), 7, 1, true)
		);
		strut.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()));
		strut.translate(mid.x, mid.y, mid.z);
		parts.push(strut);
	}

	const ring = toNonIdx(new THREE.TorusGeometry(1.88, 0.012, 10, 88));
	ring.rotateX(Math.PI * 0.36);
	ring.rotateY(0.28);
	parts.push(ring);

	return toIndexed(mergeGeometries(parts, false), true);
}

function buildNanoSatellites() {
	const parts = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	const count = 16;
	for (let i = 0; i < count; i++) {
		const y = 1 - (i / (count - 1)) * 2;
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const theta = golden * i * 1.7;
		const dist = 1.68 + (i % 4) * 0.16;
		const rad = 0.055 + (i % 3) * 0.032;
		const drop = toNonIdx(new THREE.IcosahedronGeometry(rad, 2));
		drop.translate(Math.cos(theta) * r * dist, y * dist * 0.85, Math.sin(theta) * r * dist);
		parts.push(drop);
	}
	return toIndexed(mergeGeometries(parts, false), true);
}

/* ============================================================================
 * EDITION 02: CHROME KINOKO (Saikattyo Avatar — Luxury Metallic Mushroom)
 * ========================================================================== */
function capProfilePoint(t) {
	// Smooth sculpted mushroom cap contour from underside rim (t=0) to top crown (t=1)
	// Cap sits around y = -0.05 .. +1.28, max radius ~1.34
	if (t < 0.18) {
		// Inner collar tucking into stem -> outer overhang rim
		const u = t / 0.18;
		const r = 0.62 + Math.sin(u * Math.PI * 0.5) * 0.72;
		const y = -0.04 - Math.sin(u * Math.PI) * 0.09;
		return new THREE.Vector2(r, y);
	}
	const u = (t - 0.18) / 0.82; // 0 at outer rim (r=1.34, y=-0.04), 1 at crown (r=0, y=1.28)
	const angle = u * Math.PI * 0.5;
	const r = Math.cos(angle) * 1.34;
	const y = -0.04 + Math.pow(Math.sin(angle), 0.86) * 1.32;
	return new THREE.Vector2(iSafe(r, u), y);
}

function iSafe(r, u) {
	return u >= 0.999 ? 0.0005 : Math.max(0.0005, r);
}

function buildKinokoCap() {
	const pts = [];
	const steps = 44;
	for (let i = 0; i <= steps; i++) {
		pts.push(capProfilePoint(i / steps));
	}
	const cap = toNonIdx(new THREE.LatheGeometry(pts, 64));
	return toIndexed(cap, true);
}

function buildKinokoSpots() {
	const parts = [];

	// Top crown medallion inlaid into cap apex
	const crown = toNonIdx(new THREE.SphereGeometry(0.42, 32, 20));
	crown.scale(1, 0.34, 1);
	crown.translate(0, 1.21, 0);
	parts.push(crown);

	// 4 side circular spots flush with the curved cap dome
	const spotElevU = 0.46; // midway up dome
	const pt = capProfilePoint(0.18 + spotElevU * 0.82);
	const ptAbove = capProfilePoint(0.18 + (spotElevU + 0.03) * 0.82);
	const tangent = new THREE.Vector2(ptAbove.x - pt.x, ptAbove.y - pt.y).normalize();
	// Outward 2D normal on lathe profile (right-hand normal in r,y plane)
	const outR = tangent.y;
	const outY = -tangent.x;

	const up = new THREE.Vector3(0, 1, 0);
	for (let i = 0; i < 4; i++) {
		const az = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
		const normal3D = new THREE.Vector3(
			Math.cos(az) * outR,
			Math.abs(outY),
			Math.sin(az) * outR
		).normalize();

		const pos3D = new THREE.Vector3(
			Math.cos(az) * pt.x,
			pt.y,
			Math.sin(az) * pt.x
		).addScaledVector(normal3D, -0.02);

		const spot = toNonIdx(new THREE.SphereGeometry(0.41, 28, 18));
		spot.scale(1, 0.28, 1);
		spot.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, normal3D));
		spot.translate(pos3D.x, pos3D.y, pos3D.z);
		parts.push(spot);
	}

	return toIndexed(mergeGeometries(parts, false), true);
}

function buildKinokoStem() {
	const pts = [];
	const steps = 28;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps; // 0 = bottom center, 1 = top inside cap
		if (t < 0.16) {
			const u = t / 0.16;
			pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(u * Math.PI * 0.5) * 0.58), -1.16 + (1 - Math.cos(u * Math.PI * 0.5)) * 0.16));
		} else {
			const u = (t - 0.16) / 0.84;
			const belly = Math.sin(u * Math.PI) * 0.09;
			const r = 0.58 + belly - u * 0.03;
			const y = -1.0 + u * 1.04;
			pts.push(new THREE.Vector2(r, y));
		}
	}
	const stem = toNonIdx(new THREE.LatheGeometry(pts, 56));

	// Minimalist floating orbital base ring beneath the mushroom
	const halo = toNonIdx(new THREE.TorusGeometry(1.48, 0.012, 10, 84));
	halo.rotateX(Math.PI * 0.5);
	halo.translate(0, -1.32, 0);

	return toIndexed(mergeGeometries([stem, halo], false), true);
}

function buildKinokoEyes() {
	const parts = [];
	for (const sign of [-1, 1]) {
		const eye = toNonIdx(new THREE.CapsuleGeometry(0.068, 0.24, 12, 20));
		eye.scale(0.85, 1, 0.55);
		eye.rotateX(-0.05);
		eye.translate(sign * 0.21, -0.44, 0.62);
		parts.push(eye);
	}
	return toIndexed(mergeGeometries(parts, false), true);
}

/* ============================================================================
 * EDITION 03: LIQUID MELT ("世界に融けるプロダクト" — Ferrofluid Mercury Core)
 * ========================================================================== */
function buildMeltBody() {
	const geo = new THREE.SphereGeometry(1.16, 96, 72);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const d = v.clone().normalize();
		const lobe1 = Math.sin(d.x * 3.2 + 0.5) * Math.cos(d.y * 2.8 - 0.3) * 0.22;
		const lobe2 = Math.cos(d.z * 4.1 + d.x * 2.2) * 0.13;
		const pinch = Math.sin(d.y * 5.0 + d.z * 3.0) * 0.06;
		v.copy(d).multiplyScalar(1.14 * (1 + lobe1 + lobe2 + pinch));
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	return toIndexed(geo, true);
}

function buildMeltDroplets() {
	const parts = [];
	const specs = [
		[1.56, 0.42, 0.35, 0.19],
		[-1.48, -0.52, 0.48, 0.16],
		[0.55, 1.52, -0.42, 0.14],
		[-0.68, 1.34, 0.72, 0.11],
		[1.18, -1.16, -0.58, 0.15],
		[-1.25, 0.58, -0.92, 0.12],
		[0.24, -1.58, 0.62, 0.13],
		[1.82, -0.18, 0.12, 0.08],
		[-1.78, -0.08, -0.22, 0.09],
	];
	for (const [x, y, z, r] of specs) {
		const drop = toNonIdx(new THREE.IcosahedronGeometry(r, 3));
		drop.scale(1.12, 0.92, 1.0);
		drop.translate(x, y, z);
		parts.push(drop);
	}

	const ripple = toNonIdx(new THREE.TorusGeometry(1.92, 0.009, 8, 96));
	ripple.rotateX(Math.PI * 0.44);
	ripple.rotateY(-0.22);
	parts.push(ripple);

	return toIndexed(mergeGeometries(parts, false), true);
}

/* ============================================================================
 * EDITION 04: SONIC WAFER (Semiconductor × Hip-Hop × Three.js Gyroscope)
 * ========================================================================== */
function buildWaferDisc() {
	const parts = [];

	// Main monocrystalline silicon wafer disc
	const wafer = toNonIdx(new THREE.CylinderGeometry(0.98, 0.98, 0.055, 72));
	wafer.rotateX(Math.PI * 0.5);
	parts.push(wafer);

	// Precision beveled rim ring
	const bevel = toNonIdx(new THREE.TorusGeometry(0.98, 0.028, 12, 72));
	parts.push(bevel);

	// Etched semiconductor die blocks across front & back wafer faces
	const step = 0.21;
	for (let gx = -3; gx <= 3; gx++) {
		for (let gy = -3; gy <= 3; gy++) {
			const x = gx * step;
			const y = gy * step;
			if (Math.hypot(x, y) > 0.78) continue;
			const h = 0.016 + ((Math.abs(gx * 3 + gy * 5) % 3) * 0.007);
			const die = toNonIdx(new THREE.BoxGeometry(0.165, 0.165, 0.055 + h * 2));
			die.translate(x, y, 0);
			parts.push(die);
		}
	}

	return toIndexed(mergeGeometries(parts, false), false);
}

function buildWaferAcousticRings() {
	const parts = [];
	const radii = [1.26, 1.54, 1.84];
	const tilts = [
		[0.38, -0.24, 0.1],
		[-0.46, 0.32, -0.18],
		[0.72, 0.18, 0.42],
	];

	radii.forEach((radius, rIdx) => {
		const ringParts = [];
		const baseTube = toNonIdx(new THREE.TorusGeometry(radius, 0.015, 8, 64));
		ringParts.push(baseTube);

		// Equalizer / sound-wave frequency bars around the ring (Hip-Hop beat motif)
		const bars = 36 + rIdx * 8;
		for (let b = 0; b < bars; b++) {
			const a = (b / bars) * Math.PI * 2;
			const beat =
				Math.pow(Math.abs(Math.sin(a * 4 + rIdx * 1.3)), 2.0) * 0.11 +
				Math.abs(Math.cos(a * 9 - rIdx)) * 0.04;
			if (beat < 0.035) continue;
			const bar = toNonIdx(new THREE.BoxGeometry(beat, 0.014, 0.024));
			bar.rotateZ(a);
			bar.translate(Math.cos(a) * radius, Math.sin(a) * radius, 0);
			ringParts.push(bar);
		}

		const ringMerged = mergeGeometries(ringParts, false);
		ringMerged.rotateX(tilts[rIdx][0]);
		ringMerged.rotateY(tilts[rIdx][1]);
		ringMerged.rotateZ(tilts[rIdx][2]);
		parts.push(ringMerged);
	});

	return toIndexed(mergeGeometries(parts, false), false);
}

/* ============================================================================
 * BINARY GLTF 2.0 (.GLB) PACKER
 * ========================================================================== */
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
			attributes: { POSITION: posAccIdx, NORMAL: normAccIdx },
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

		meshes.push({ name: entry.name, primitives: [primitive] });
		nodes.push({ name: entry.name, mesh: idx });
	});

	const binBuffer = Buffer.concat(bufferChunks);
	const gltf = {
		asset: { version: '2.0', generator: 'saikattyo-editions-builder' },
		scene: 0,
		scenes: [{ name: 'SaikattyoEditions', nodes: nodes.map((_, i) => i) }],
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

for (const stale of ['nano-assembly.glb', 'orbital-craft.glb', 'saikattyo-editions.glb']) {
	const p = path.join(outDir, stale);
	if (fs.existsSync(p)) fs.unlinkSync(p);
}

const editions = [
	{
		file: 'edition-01-nano.glb',
		meshes: [
			{
				name: 'Nano_Core',
				geometry: buildNanoCore(),
				color: [0.06, 0.58, 0.62, 1.0],
				metallic: 0.9,
				roughness: 0.14,
			},
			{
				name: 'Nano_Cage',
				geometry: buildNanoCage(),
				color: [0.82, 0.86, 0.91, 1.0],
				metallic: 0.94,
				roughness: 0.18,
			},
			{
				name: 'Nano_Satellites',
				geometry: buildNanoSatellites(),
				color: [0.68, 0.92, 0.98, 1.0],
				metallic: 0.92,
				roughness: 0.12,
			},
		],
	},
	{
		file: 'edition-02-kinoko.glb',
		meshes: [
			{
				name: 'Kinoko_Cap',
				geometry: buildKinokoCap(),
				color: [0.78, 0.1, 0.14, 1.0],
				metallic: 0.88,
				roughness: 0.14,
			},
			{
				name: 'Kinoko_Spots',
				geometry: buildKinokoSpots(),
				color: [0.94, 0.96, 0.98, 1.0],
				metallic: 0.92,
				roughness: 0.12,
			},
			{
				name: 'Kinoko_Stem',
				geometry: buildKinokoStem(),
				color: [0.76, 0.79, 0.84, 1.0],
				metallic: 0.9,
				roughness: 0.2,
			},
			{
				name: 'Kinoko_Eyes',
				geometry: buildKinokoEyes(),
				color: [0.03, 0.04, 0.06, 1.0],
				metallic: 0.95,
				roughness: 0.08,
			},
		],
	},
	{
		file: 'edition-03-melt.glb',
		meshes: [
			{
				name: 'Melt_Body',
				geometry: buildMeltBody(),
				color: [0.88, 0.91, 0.95, 1.0],
				metallic: 0.98,
				roughness: 0.06,
			},
			{
				name: 'Melt_Droplets',
				geometry: buildMeltDroplets(),
				color: [0.72, 0.86, 0.96, 1.0],
				metallic: 0.96,
				roughness: 0.09,
			},
		],
	},
	{
		file: 'edition-04-wafer.glb',
		meshes: [
			{
				name: 'Wafer_Disc',
				geometry: buildWaferDisc(),
				color: [0.14, 0.18, 0.26, 1.0],
				metallic: 0.92,
				roughness: 0.14,
			},
			{
				name: 'Wafer_AcousticRings',
				geometry: buildWaferAcousticRings(),
				color: [0.85, 0.89, 0.94, 1.0],
				metallic: 0.93,
				roughness: 0.18,
			},
		],
	},
];

for (const ed of editions) {
	const glb = packGlb(ed.meshes);
	const outPath = path.join(outDir, ed.file);
	fs.writeFileSync(outPath, glb);
	console.log(`Generated ${ed.file} (${(glb.length / 1024).toFixed(1)} KB)`);
}
