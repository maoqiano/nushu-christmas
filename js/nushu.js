import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOutlines } from './nushu-outlines.js';

const words = [
    { word: '自由', fontWeight: 350, size: 1.14, width: 0.95, stretch: 1.10, form: 'sphere', deformation: 1.10 },
    { word: '女书', fontWeight: 400, size: 1.05, width: 0.84, stretch: 1.15, form: 'upright', deformation: 0.08 },
    { word: '强大', fontWeight: 480, size: 1.10, width: 0.96, stretch: 1.01, form: 'faceted', deformation: 1.14 },
    { word: '独立', fontWeight: 350, size: 0.94, width: 0.89, stretch: 1.09, form: 'upright', deformation: 0.32 },
    { word: '勇气', fontWeight: 400, size: 1.02, width: 0.92, stretch: 1.05, form: 'upright', deformation: 0.25 },
    { word: '爱', fontWeight: 400, size: 0.96, width: 0.98, stretch: 1.18, form: 'upright', deformation: 0.14, copies: 2 },
    { word: '自己', fontWeight: 350, size: 0.95, width: 0.87, stretch: 1.11, form: 'upright', deformation: 0.19 },
    { word: '幸福', fontWeight: 400, size: 1.01, width: 0.93, stretch: 1.06, form: 'sphere', deformation: 1.00 },
];

export function createNushuGeometries() {
    const loader = new SVGLoader();
    const totalCopies = words.reduce((total, { copies = 1 }) => total + copies, 0);
    return words.map((style) => {
        let cubeGeometry;
        const getCubeGeometry = () => {
            cubeGeometry ??= describeGeometry(modelCube(extrudeWord(loader, style, true), style), style, 'faceted');
            return cubeGeometry;
        };
        const geometry = style.form === 'faceted'
            ? getCubeGeometry()
            : describeGeometry(modelWord(extrudeWord(loader, style), style), style, style.form);
        return { word: style.word, geometry, getCubeGeometry, weight: (style.copies ?? 1) / totalCopies };
    });
}

function describeGeometry(geometry, style, form) {
    geometry.userData = { form, size: style.size, fontWeight: style.fontWeight };
    return geometry;
}

function extrudeWord(loader, { word, fontWeight, width, stretch }, forCube = false) {
    const glyphHeight = 0.84 * stretch;
    const paths = Array.from(word, (character, index) => {
        // 字形轮廓的 Y 轴朝上，先转成 SVG 坐标，保留词语从上到下的顺序。
        const baseline = glyphHeight + index * (glyphHeight + 0.16);
        return `<path d="${glyphOutlines[fontWeight][character]}" transform="translate(0 ${baseline}) scale(${width} ${-stretch})"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
    const shapes = loader.parse(svg).paths.flatMap((path) => SVGLoader.createShapes(path));
    const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: 0.096,
        // 微型方块每个词重复六次，保留字的挤出厚度，用较少的轮廓分段。
        bevelEnabled: !forCube,
        bevelThickness: 0.009,
        bevelSize: 0.006,
        bevelSegments: 1,
        curveSegments: forCube ? 1 : 3,
    });

    // 把 SVG 转为 Three.js 的 Y 轴朝上坐标，再让渐变跟随字形。
    geometry.rotateX(Math.PI);
    geometry.center();
    geometry.deleteAttribute('uv');
    const indexed = mergeVertices(geometry);
    geometry.dispose();

    const { min, max } = indexed.boundingBox;
    const position = indexed.getAttribute('position');
    const normal = indexed.getAttribute('normal');
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
        uv[i * 2] = 0.25 + 0.5 * Math.abs(normal.getZ(i));
        uv[i * 2 + 1] = (position.getY(i) - min.y) / (max.y - min.y);
    }
    indexed.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return indexed;
}

function modelWord(geometry, { form, deformation }) {
    const { min, max } = geometry.boundingBox;
    const height = max.y - min.y;

    if (form === 'upright') {
        const position = geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
            const x = position.getX(i);
            const y = position.getY(i);
            const z = position.getZ(i);
            const angle = (y / height) * deformation;
            position.setXYZ(i, x * Math.cos(angle) + z * Math.sin(angle), y, z * Math.cos(angle) - x * Math.sin(angle));
        }
        geometry.computeVertexNormals();
        return geometry.center();
    }

    const width = max.x - min.x;
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
        const latitude = (position.getY(i) / height) * 2.45 * deformation;
        const longitude = (position.getX(i) / width) * 1.38 * deformation;
        const radius = 0.69 + position.getZ(i);
        const ringRadius = radius * Math.cos(latitude);
        position.setXYZ(i, ringRadius * Math.sin(longitude), radius * Math.sin(latitude), ringRadius * Math.cos(longitude));
    }
    geometry.computeVertexNormals();
    // 三份弯曲字面围成球壳。
    const faces = rotateAroundY(geometry, 3);
    geometry.dispose();
    return assembleGeometry(faces);
}

function modelCube(geometry, { form, deformation }) {
    const side = 1.26;
    const halfSide = side / 2;
    const { min, max } = geometry.boundingBox;
    const height = max.y - min.y;
    const width = max.x - min.x;
    const scale = (side * 0.87) / height;
    const widthFactor = form === 'faceted' ? deformation : 1;
    const scaleX = Math.min((side * 0.86) / width, scale * 1.43 * widthFactor);
    geometry.scale(scaleX, scale, scale);
    geometry.translate(0, 0, halfSide);
    const faces = rotateAroundY(geometry, 4);
    faces.push(geometry.clone().rotateX(-Math.PI / 2), geometry.clone().rotateX(Math.PI / 2));
    geometry.dispose();

    const core = new THREE.BoxGeometry(1.216, 1.216, 1.216);
    const uv = core.getAttribute('uv');
    // 渐变 UV 的左侧标记实体部分，用于内光着色。
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0);
    return assembleGeometry(faces.concat(makeFacetEdges(side), core));
}

function makeFacetEdges(side) {
    const thickness = 0.013;
    const halfSide = side / 2;
    const vertical = new THREE.BoxGeometry(thickness, side, thickness).translate(halfSide, 0, halfSide);
    const top = new THREE.BoxGeometry(side, thickness, thickness).translate(0, halfSide, halfSide);
    const bottom = top.clone().translate(0, -side, 0);
    const edges = [];
    for (const edge of [vertical, top, bottom]) {
        const position = edge.getAttribute('position');
        const uv = edge.getAttribute('uv');
        // 边棱用渐变的低光区，让转角可见、字面仍然更亮。
        for (let i = 0; i < position.count; i++) {
            uv.setXY(i, 0.25, 0.12 + 0.42 * (position.getY(i) / side + 0.5));
        }
        for (let sideIndex = 0; sideIndex < 4; sideIndex++) {
            edges.push(edge.clone().rotateY(sideIndex * Math.PI / 2));
        }
        edge.dispose();
    }
    return edges;
}

function rotateAroundY(face, count) {
    return Array.from({ length: count }, (_, index) =>
        face.clone().rotateY((index / count) * Math.PI * 2),
    );
}

function assembleGeometry(parts) {
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    return geometry.center();
}
