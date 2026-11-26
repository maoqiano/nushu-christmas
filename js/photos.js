/**
 * 树身各挂两张横、竖照片。替换时复用对应相框，保留当前的聚焦目标。
 */
import * as THREE from 'three';
import { CONFIG, STATE } from './config.js';
import { mainGroup } from './scene.js';
import { Particle, particleSystem } from './particle.js';
import { createPlaceholderTexture } from './utils.js';
import { setPhotoMount } from './ornament-spacing.js';

const textureLoader = new THREE.TextureLoader();
const frameGeometry = new THREE.BoxGeometry(1.4, 1.4, 0.05);
const frameMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(CONFIG.colors.champagneGold).multiplyScalar(0.62),
    metalness: 0.78,
    roughness: 0.36,
    envMapIntensity: 0.42,
});
const imageGeometry = new THREE.PlaneGeometry(1.2, 1.2);
const photos = [];
let uploadRevision = 0;

export function initPhotos() {
    CONFIG.photos.slots.forEach((slot, index) => {
        const { orientation, fallbackImage, placeholderAspect } = slot;
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);
        const image = new THREE.Mesh(imageGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        const mesh = new THREE.Group();
        image.position.z = 0.04;
        mesh.add(frame, image);
        mesh.userData.focusSpan = 1.4;
        mesh.userData.photoOrientation = orientation;
        mainGroup.add(mesh);

        const photo = { mesh, frame, image, orientation, fallbackImage, revision: 0 };
        photos.push(photo);
        setPhotoTexture(photo, createPlaceholderTexture(index, placeholderAspect));

        const particle = new Particle(mesh, 'PHOTO');
        setPhotoMount(particle.posTree, slot);
        mesh.position.copy(particle.posTree);
        particleSystem.push(particle);
    });
}

export async function loadInitialPhotos() {
    const missing = new Set(photos);
    for (const name of await readManifest()) {
        const texture = await loadPhoto(`./images/${name}`);
        if (!texture) continue;
        const orientation = photoOrientation(texture);
        const photo = photos.find((slot) => slot.orientation === orientation && missing.has(slot));
        if (photo) {
            missing.delete(photo);
            applyPhotoTexture(photo, texture, 0);
        } else {
            texture.dispose();
        }
        if (!missing.size) return;
    }

    await Promise.all([...missing].map(async (photo) => {
        if (photo.revision !== 0) return;
        const texture = await loadPhoto(photo.fallbackImage);
        if (texture) applyPhotoTexture(photo, texture, 0);
    }));
}

async function readManifest() {
    try {
        const res = await fetch(CONFIG.preload.manifest, { cache: 'no-cache' });
        if (!res.ok) return [];
        const list = await res.json();
        return Array.isArray(list) ? list.filter((name) => typeof name === 'string' && name.trim()) : [];
    } catch {
        return [];
    }
}

async function loadPhoto(url) {
    try {
        return await textureLoader.loadAsync(url);
    } catch {
        return null;
    }
}

function photoOrientation(texture) {
    const { width, height } = texture.image;
    return width > height ? 'landscape' : 'portrait';
}

function applyPhotoTexture(photo, texture, revision) {
    if (revision < photo.revision) {
        texture.dispose();
        return;
    }
    photo.revision = revision;
    setPhotoTexture(photo, texture);
}

function setPhotoTexture({ frame, image }, texture) {
    const aspect = texture.image.width / texture.image.height;
    const width = Math.min(1, aspect);
    const height = Math.min(1, 1 / aspect);
    frame.scale.set(width, height, 1);
    image.scale.set(width, height, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    image.material.map?.dispose();
    image.material.map = texture;
    image.material.needsUpdate = true;
}

export async function handleImageUpload(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file?.type.startsWith('image/')) return;

    const focused = STATE.mode === 'FOCUS' ? STATE.focusTarget : null;
    const revision = ++uploadRevision;
    const url = URL.createObjectURL(file);
    try {
        const texture = await loadPhoto(url);
        if (!texture) {
            console.warn(`[tree] 无法读取 ${file.name}`);
            return;
        }
        const orientation = photoOrientation(texture);
        const slots = photos.filter((photo) => photo.orientation === orientation);
        // 先替换正在查看的同向相框，其他时候依次使用同向相框。
        const target = slots.find((photo) => photo.mesh === focused)
            ?? slots.reduce((oldest, photo) => photo.revision < oldest.revision ? photo : oldest);
        applyPhotoTexture(target, texture, revision);
    } finally {
        URL.revokeObjectURL(url);
    }
}
