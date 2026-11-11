import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function toCleanIndexed(geo) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	g.deleteAttribute('normal');
	const indexed = mergeVertices(g, 1e-4);
	indexed.computeVertexNormals();
	return indexed;
}

function toNonIdx(geo) {
	const g = geo.index ? geo.toNonIndexed() : geo.clone();
	g.deleteAttribute('uv');
	return g;
}

function buildCoreNucleus() {
	const geo = new THREE.IcosahedronGeometry(0.78, 4);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const dir = v.clone().normalize();
		const harmonic =
			Math.sin(dir.x * 7.0) * Math.cos(dir.y * 7.0) * Math.sin(dir.z * 7.0);
		const ridge = Math.cos(dir.x * 12.0 + dir.y * 12.0) * 0.035;
		const scale = 1.0 + harmonic * 0.11 + ridge;
		v.copy(dir).multiplyScalar(0.76 * scale);
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	return toCleanIndexed(geo);
}

function buildRefractiveShell() {
	// Flat-faceted crystal polyhedron shell (keep non-indexed for sharp jewel facets)
	const geo = toNonIdx(new THREE.DodecahedronGeometry(1.14, 1));
	geo.computeVertexNormals();
	return geo;
}

function buildMolecularCage() {
	const base = new THREE.DodecahedronGeometry(1.48, 0);
	const pos = base.attributes.position;
	const uniqueVerts = [];
	const eps = 1e-4;

	for (let i = 0; i < pos.count; i++) {
		const candidate = new THREE.Vector3().fromBufferAttribute(pos, i);
		if (!uniqueVerts.some((u) => u.distanceTo(candidate) < eps)) {
			uniqueVerts.push(candidate);
		}
	}

	const parts = [];
	for (const v of uniqueVerts) {
		const atom = toNonIdx(new THREE.IcosahedronGeometry(0.088, 1));
		atom.translate(v.x, v.y, v.z);
		parts.push(atom);
	}

	const pairs = [];
	for (let i = 0; i < uniqueVerts.length; i++) {
		for (let j = i + 1; j < uniqueVerts.length; j++) {
			pairs.push({ i, j, dist: uniqueVerts[i].distanceTo(uniqueVerts[j]) });
		}
	}
	pairs.sort((a, b) => a.dist - b.dist);
	const edgeThreshold = pairs[0].dist * 1.08;

	const up = new THREE.Vector3(0, 1, 0);
	for (const p of pairs) {
		if (p.dist > edgeThreshold) break;
		const a = uniqueVerts[p.i];
		const b = uniqueVerts[p.j];
		const mid = a.clone().add(b).multiplyScalar(0.5);
		const dir = b.clone().sub(a);
		const len = dir.length();

		const strut = toNonIdx(new THREE.CylinderGeometry(0.022, 0.022, len, 8, 1, true));
		const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
		strut.applyQuaternion(quat);
		strut.translate(mid.x, mid.y, mid.z);
		parts.push(strut);
	}

	return toCleanIndexed(mergeGeometries(parts, false));
}

function buildGimbalRing(radius, tube, markersCount, tiltRad) {
	const parts = [];
	parts.push(toNonIdx(new THREE.TorusGeometry(radius, tube, 14, 72)));

	for (let i = 0; i < markersCount; i++) {
		const angle = (i / markersCount) * Math.PI * 2;
		const isMajor = i % 3 === 0;
		const marker = toNonIdx(
			new THREE.OctahedronGeometry(isMajor ? tube * 3.2 : tube * 1.9, 0)
		);
		marker.translate(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
		parts.push(marker);
	}

	const merged = toCleanIndexed(mergeGeometries(parts, false));
	merged.rotateX(tiltRad);
	merged.computeVertexNormals();
	return merged;
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
			generator: 'saikattyo-nano-model-builder',
		},
		scene: 0,
		scenes: [
			{
				name: 'SaikattyoNanoAssembly',
				nodes: nodes.map((_, i) => i),
			},
		],
		nodes,
		meshes,
		materials,
		accessors,
		bufferViews,
		buffers: [
			{
				byteLength: binBuffer.length,
			},
		],
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
		name: 'CoreNucleus',
		geometry: buildCoreNucleus(),
		color: [0.08, 0.72, 0.76, 1.0],
		metallic: 0.88,
		roughness: 0.16,
	},
	{
		name: 'RefractiveShell',
		geometry: buildRefractiveShell(),
		color: [0.75, 0.96, 0.98, 0.35],
		metallic: 0.1,
		roughness: 0.08,
		doubleSided: true,
	},
	{
		name: 'MolecularCage',
		geometry: buildMolecularCage(),
		color: [0.86, 0.92, 0.96, 1.0],
		metallic: 0.92,
		roughness: 0.22,
	},
	{
		name: 'GimbalRingOuter',
		geometry: buildGimbalRing(2.05, 0.024, 12, Math.PI * 0.22),
		color: [0.35, 0.92, 0.86, 1.0],
		metallic: 0.85,
		roughness: 0.2,
	},
	{
		name: 'GimbalRingInner',
		geometry: buildGimbalRing(1.76, 0.018, 9, -Math.PI * 0.31),
		color: [0.95, 0.42, 0.52, 1.0],
		metallic: 0.8,
		roughness: 0.25,
	},
]);

const outPath = path.join(outDir, 'nano-assembly.glb');
fs.writeFileSync(outPath, glb);
console.log(`Generated ${outPath} (${(glb.length / 1024).toFixed(1)} KB)`);
