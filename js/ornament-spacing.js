import { Vector3 } from 'three';
import { CONFIG } from './config.js';

const clearance = 0.04;
const maxAttempts = 72;

const crownStart = 0.69;
const crownEnd = 0.94;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

export function setPhotoMount(position, { mountHeight, mountAngle }) {
    const { treeHeight, treeRadius } = CONFIG.particles;
    const radius = treeRadius * (1 - mountHeight);
    return position.set(Math.sin(mountAngle) * radius, (mountHeight - 0.5) * treeHeight, Math.cos(mountAngle) * radius);
}

export function arrangeOrnaments(particles) {
    const crown = spreadCrownSpheres(particles);
    placeOrnaments(particles, 'posTree', crown);
    placeOrnaments(particles, 'posScatter', new Set());
}

function spreadCrownSpheres(particles) {
    const lowerHeight = (crownStart - 0.5) * CONFIG.particles.treeHeight;
    const balls = particles
        .filter((p) => (p.type === 'RED' || p.type === 'GOLD_SPHERE') && p.posTree.y >= lowerHeight)
        .sort((a, b) => a.posTree.y - b.posTree.y);
    balls.forEach((particle, index) => {
        const fraction = (index + 0.5) / balls.length;
        const height = crownStart + fraction * (crownEnd - crownStart);
        setCrownSpherePosition(particle.posTree, height, index * goldenAngle, 0.95);
    });
    return new Set(balls);
}

function setCrownSpherePosition(position, height, angle, radiusFactor) {
    const { treeHeight, treeRadius } = CONFIG.particles;
    const radius = treeRadius * (1 - height) * radiusFactor;
    position.set(Math.cos(angle) * radius, (height - 0.5) * treeHeight, Math.sin(angle) * radius);
}

function placeOrnaments(particles, layout, crown) {
    const entries = particles.map((particle) => boundsFor(particle, layout, crown.has(particle)));
    const volumes = entries.filter(({ reservesSpace }) => reservesSpace);
    volumes.sort((a, b) => b.radius - a.radius);

    const occupied = [];
    if (layout === 'posTree') {
        const size = CONFIG.photos.mountClearance;
        for (const slot of CONFIG.photos.slots) {
            occupied.push({ position: setPhotoMount(new Vector3(), slot), radius: size, halfHeight: size });
        }
    }
    for (const volume of volumes) {
        findSpace(volume, occupied, layout);
        occupied.push(volume);
    }
    for (const entry of entries) {
        if (!entry.reservesSpace) findSpace(entry, occupied, layout);
    }
}

function boundsFor(particle, layout, crownSphere = false) {
    const geometry = particle.instanced.mesh.geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();

    const { form } = geometry.userData;
    const sphere = geometry.boundingSphere;
    const radius = (sphere.radius + sphere.center.length()) * particle.baseScale;
    const upright = layout === 'posTree' && form === 'upright';
    const entry = {
        particle,
        position: particle[layout],
        radius,
        halfHeight: radius,
        upright,
        crownSphere,
        reservesSpace: crownSphere || form === 'sphere' || form === 'faceted',
    };

    // 树形状态下竖排文字保持直立，用实际宽度留出空间，避免把细字当成大球。
    if (upright) {
        const { min, max } = geometry.boundingBox;
        const width = Math.max(Math.abs(min.x), Math.abs(max.x));
        const depth = Math.max(Math.abs(min.z), Math.abs(max.z));
        const height = Math.max(Math.abs(min.y), Math.abs(max.y));
        entry.radius = (Math.hypot(width, depth) + height * 0.12) * particle.baseScale;
        entry.halfHeight = height * particle.baseScale;
    }
    return entry;
}

function findSpace(entry, occupied, layout) {
    let bestOverlap = placementCost(entry, occupied, layout);
    if (bestOverlap === 0) return;

    const best = entry.position.clone();
    const { particle } = entry;
    for (let i = 0; i < maxAttempts; i++) {
        if (entry.crownSphere) {
            const height = crownStart + Math.random() * (crownEnd - crownStart);
            setCrownSpherePosition(entry.position, height, Math.random() * Math.PI * 2, 0.88 + Math.random() * 0.20);
        } else if (layout === 'posTree') particle.randomizeTreePosition();
        else particle.randomizeScatterPosition(8, 12);

        const overlap = placementCost(entry, occupied, layout);
        if (overlap === 0) return;
        if (overlap < bestOverlap) {
            bestOverlap = overlap;
            best.copy(entry.position);
        }
    }
    entry.position.copy(best);
}

function placementCost(entry, occupied, layout) {
    const overlap = measureOverlap(entry, occupied);
    if (layout !== 'posTree') return overlap;

    const { treeHeight, treeRadius } = CONFIG.particles;
    const height = 0.5 + entry.position.y / treeHeight;
    if (entry.reservesSpace) {
        // 树尖过窄时往下放大挂件，保留顶部的锥形轮廓。
        const coneRadius = treeRadius * (1 - height);
        return overlap + Math.max(0, entry.radius * 1.65 - coneRadius);
    }
    if (entry.particle.type === 'RED' || entry.particle.type === 'GOLD_SPHERE') {
        return overlap + Math.max(0, height - crownStart);
    }
    return overlap;
}

function measureOverlap(entry, occupied) {
    let overlap = 0;
    const { position, radius, upright, halfHeight } = entry;
    for (const other of occupied) {
        const dx = position.x - other.position.x;
        const dy = position.y - other.position.y;
        const dz = position.z - other.position.z;
        const minimum = radius + other.radius + clearance;
        if (upright) {
            const vertical = halfHeight + other.halfHeight + clearance - Math.abs(dy);
            const horizontalDistance = dx * dx + dz * dz;
            if (vertical > 0 && horizontalDistance < minimum * minimum) {
                overlap += Math.min(vertical, minimum - Math.sqrt(horizontalDistance));
            }
        } else {
            const squaredDistance = dx * dx + dy * dy + dz * dz;
            if (squaredDistance < minimum * minimum) overlap += minimum - Math.sqrt(squaredDistance);
        }
    }
    return overlap;
}
