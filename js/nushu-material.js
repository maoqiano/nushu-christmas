import * as THREE from 'three';
import { CONFIG } from './config.js';
import { reducedMotion } from './utils.js';

const palettes = new Map([
    [CONFIG.colors.accentRed, {
        min: 0.43, max: 0.87, phase: 0,
        gradients: [
            [0x80142d, 0xe54059, 0xffc08b],
            [0x5c1247, 0xb9388f, 0xff9aba],
            [0x8c1b24, 0xf25b36, 0xffce73],
            [0x730f29, 0xcc2541, 0xff8294],
            [0x65254a, 0xb75588, 0xffb1a2],
            [0x932c2c, 0xed6744, 0xffb896],
        ],
    }],
    [CONFIG.colors.champagneGold, {
        min: 0.78, max: 1.30, phase: 0.7,
        gradients: [
            [0x7a4518, 0xe39b38, 0xffebae],
            [0x8a4721, 0xd27438, 0xffce98],
            [0x7c5820, 0xd5a240, 0xffe477],
            [0x876734, 0xd9b45e, 0xfff2cf],
            [0x8b5128, 0xda9065, 0xffdec1],
            [0x714916, 0xe5ae38, 0xffda85],
        ],
    }],
    [CONFIG.colors.deepGreen, {
        min: 0.23, max: 0.56, phase: 1.4,
        gradients: [
            [0x185644, 0x39a678, 0xa0ef9d],
            [0x18554d, 0x2da68f, 0x8aeed5],
            [0x3a602b, 0x75a236, 0xd6ee82],
            [0x24533e, 0x54a565, 0xa9dba7],
            [0x175051, 0x3aa18f, 0x85ded1],
            [0x345330, 0x5da151, 0xbce08a],
        ],
    }],
]);

export const nushuFinishes = [
    {
        name: 'metal', weight: 0.36, tint: 0.36, phase: 0.18, glow: 0.73,
        properties: { metalness: 0.94, roughness: 0.14, clearcoat: 0.36, clearcoatRoughness: 0.12, envMapIntensity: 1.35 },
    },
    {
        name: 'candy', weight: 0.34, tint: 0.58, phase: 0.40, glow: 0.91,
        properties: { metalness: 0.05, roughness: 0.19, clearcoat: 1, clearcoatRoughness: 0.055, ior: 1.48, envMapIntensity: 1.15 },
    },
    {
        name: 'glitter', weight: 0.30, tint: 0.45, phase: 0.67, glow: 0.84,
        properties: { metalness: 0.67, roughness: 0.44, clearcoat: 0.22, iridescence: 0.28, envMapIntensity: 1.25 },
    },
];

const glowTextures = new Map();
const glowingMaterials = [];
const BREATH_PERIOD = 5.8;

export function createNushuMaterial(baseMaterial, wordIndex, finish, hasLamp = false) {
    const family = baseMaterial.color.getHex();
    const palette = palettes.get(family);
    const stops = palette.gradients[wordIndex % palette.gradients.length];
    if (!glowTextures.has(stops)) glowTextures.set(stops, createGlowGradient(stops));

    const material = finish
        ? new THREE.MeshPhysicalMaterial({
            ...finish.properties,
            color: baseMaterial.color.clone().lerp(new THREE.Color(stops[1]), finish.tint),
        })
        : baseMaterial.clone();
    material.envMapIntensity *= 1.30;
    material.userData = { nushuFamily: family, finish: finish?.name ?? 'original', hasLamp };
    material.emissive.set(0xffffff);
    material.emissiveMap = glowTextures.get(stops);
    const gain = finish?.glow ?? 1;
    material.emissiveIntensity = palette.min * gain;
    const glitter = finish?.name === 'glitter';
    material.onBeforeCompile = (shader) => addNushuShading(shader, glitter, hasLamp);
    material.customProgramCacheKey = () => `nushu-${glitter ? 'glitter' : 'glow'}-${hasLamp ? 'lamp' : 'surface'}`;
    glowingMaterials.push({ material, palette, gain, phase: palette.phase + wordIndex * 0.4 + (finish?.phase ?? 0) });
    return material;
}

function addNushuShading(shader, glitter, hasLamp) {
    const varyings = `varying float vNushuGlow;
        varying float vNushuCore;
        ${hasLamp ? 'varying vec3 vNushuCenter; varying float vNushuScale;' : ''}
        ${glitter ? 'varying vec3 vNushuSurface;' : ''}`;
    // 每件方体使用自身的中心和缩放，内光会随它一起转动、缩放和移动。
    const lampPosition = hasLamp ? `
        vec4 lampCenter = vec4(0.0, 0.0, 0.0, 1.0);
        vNushuScale = length(modelMatrix[0].xyz);
        #ifdef USE_INSTANCING
            lampCenter = instanceMatrix * lampCenter;
            vNushuScale *= length(instanceMatrix[0].xyz);
        #endif
        vNushuCenter = (modelViewMatrix * lampCenter).xyz;` : '';
    const lampLight = hasLamp ? `
        if (vNushuCore > 0.5) {
            // 到视线的距离用来模拟小灯芯和实体表面扩散开的暖光。
            vec3 offsetFromViewRay = cross(normalize(vViewPosition), vNushuCenter);
            float lampDistance = dot(offsetFromViewRay, offsetFromViewRay) / max(vNushuScale * vNushuScale, 0.0001);
            float lampFalloff = 0.48 * exp2(-11.0 * lampDistance) + 0.82 * exp2(-160.0 * lampDistance);
            totalEmissiveRadiance += vec3(1.0, 0.70, 0.36) * lampFalloff * emissive * vNushuGlow;
        }` : '';
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
            ${varyings}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
            vNushuGlow = 1.0;
            vNushuCore = 1.0 - step(0.125, uv.x);
            #ifdef USE_INSTANCING_COLOR
                vNushuGlow = instanceColor.r;
            #endif
            ${lampPosition}
            ${glitter ? 'vNushuSurface = position;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
            ${varyings}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb *= mix(1.0, 0.39, vNushuCore);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            roughnessFactor = mix(roughnessFactor, 0.38, vNushuCore);
            metalnessFactor = mix(metalnessFactor, 0.6, vNushuCore);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            totalEmissiveRadiance *= vNushuGlow * (1.0 - vNushuCore);
            ${glitter ? 'totalEmissiveRadiance += vec3(1.0, 0.88, 0.75) * (2.5 * nushuFleck * max3(totalEmissiveRadiance));' : ''}
            ${lampLight}`);

    if (glitter) {
        // 用字形自身的坐标定位亮片，文字旋转时亮片会跟着材质走。
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
                vec3 nushuGrid = vNushuSurface * 28.0;
                float nushuSeed = fract(sin(dot(floor(nushuGrid), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                float nushuFleck = smoothstep(0.80, 0.98, nushuSeed)
                    * (1.0 - smoothstep(0.08, 0.45, length(fract(nushuGrid.xy) - 0.5)));
                roughnessFactor = mix(roughnessFactor, 0.12, nushuFleck);`,
        );
    }
}

export function updateNushuGlow(elapsedTime) {
    const angle = (elapsedTime / BREATH_PERIOD) * Math.PI * 2;
    const animate = !reducedMotion.matches;
    for (const { material, palette, gain, phase } of glowingMaterials) {
        const breath = animate ? 0.5 + 0.5 * Math.sin(angle + phase) : 0.5;
        material.emissiveIntensity = THREE.MathUtils.lerp(palette.min, palette.max, breath) * gain;
    }
}

function createGlowGradient(stops) {
    const width = 2;
    const height = 48;
    const data = new Uint8Array(width * height * 4);
    const colors = stops.map((hex) => new THREE.Color(hex));
    const gradient = new THREE.Color();
    const color = new THREE.Color();
    for (let y = 0; y < height; y++) {
        const t = (y / (height - 1)) * (colors.length - 1);
        const left = Math.min(Math.floor(t), colors.length - 2);
        gradient.lerpColors(colors[left], colors[left + 1], t - left);
        // 两列分别给侧面和字面取样，倒角在两者间插值。
        for (let x = 0; x < width; x++) {
            color.copy(gradient).multiplyScalar(x === 0 ? 0.46 : 1).convertLinearToSRGB();
            const offset = (y * width + x) * 4;
            data.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], offset);
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}
