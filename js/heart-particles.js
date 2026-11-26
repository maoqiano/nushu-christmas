import * as THREE from 'three';
import { CONFIG, STATE } from './config.js';
import { reducedMotion } from './utils.js';

const maxHearts = 108;
const heartScale = 1.3;
const redsAndGold = [0xb70d24, 0xe02436, 0xfa3d48, 0xc20c33, 0xf45342, 0xd53b36, 0xffb449, 0xffd37d]
    .map((hex) => new THREE.Color(hex));
const particles = [];
const dummy = new THREE.Object3D();
const point = new THREE.Vector3();
const tree = { top: new THREE.Vector2(), base: new THREE.Vector2(), radius: 0, lowerEdge: 0 };
let scene;
let camera;
let mesh;
let control = null;
let elapsed = 0;
let spawnCredit = 0;
let width;
let height;

function showTree() {
    STATE.mode = 'TREE';
    STATE.focusTarget = null;
}

export function setHeartGesture(held) {
    if (held) {
        control = 'gesture';
        showTree();
    } else if (control === 'gesture') {
        control = null;
    }
}

export function toggleHeartPreview() {
    control = control === 'keyboard' ? null : 'keyboard';
    if (control) showTree();
}

function init(environment) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.49);
    shape.bezierCurveTo(-0.115, -0.35, -0.51, -0.105, -0.51, 0.19);
    shape.bezierCurveTo(-0.51, 0.53, -0.14, 0.57, 0, 0.31);
    shape.bezierCurveTo(0.14, 0.57, 0.51, 0.53, 0.51, 0.19);
    shape.bezierCurveTo(0.51, -0.105, 0.115, -0.35, 0, -0.49);
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.10, bevelEnabled: true, bevelSize: 0.075, bevelThickness: 0.075, bevelSegments: 4, curveSegments: 8,
    }).center();
    const material = new THREE.MeshPhysicalMaterial({
        metalness: 0.21, roughness: 0.29, clearcoat: 0.84, clearcoatRoughness: 0.24, envMapIntensity: 0.65,
    });
    mesh = new THREE.InstancedMesh(geometry, material, maxHearts);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;

    scene = new THREE.Scene();
    scene.environment = environment;
    const key = new THREE.DirectionalLight(0xffe2b7, 2.1);
    key.position.set(-190, 280, 410);
    const rim = new THREE.DirectionalLight(0xff677d, 0.80);
    rim.position.set(190, -95, -200);
    scene.add(mesh, new THREE.AmbientLight(0xffeee5, 0.95), key, rim);
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
    camera.position.z = 480;
}

function resize() {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    if (width === nextWidth && height === nextHeight) return;
    for (const heart of particles) {
        heart.x *= nextWidth / width;
        heart.y *= nextHeight / height;
    }
    width = nextWidth;
    height = nextHeight;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
}

function projectTree(view, group) {
    const halfHeight = CONFIG.particles.treeHeight / 2;
    const project = (x, y, z) => point.set(x, y, z).applyMatrix4(group.matrixWorld).project(view);
    const place = (dest) => dest.set((0.5 + point.x / 2) * width, (0.5 - point.y / 2) * height);
    project(0, halfHeight + 2, 0);
    place(tree.top);
    project(0, -halfHeight, 0);
    place(tree.base);
    tree.radius = 0;
    tree.lowerEdge = tree.base.y;
    for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const radius = CONFIG.particles.treeRadius + 0.7;
        project(radius * Math.cos(angle), -halfHeight, radius * Math.sin(angle));
        tree.radius = Math.max(tree.radius, Math.abs((0.5 + point.x / 2) * width - tree.base.x));
        tree.lowerEdge = Math.max(tree.lowerEdge, (0.5 - point.y / 2) * height);
    }
}

function avoidTree(heart) {
    const padding = heart.size * 0.68;
    if (heart.y < tree.top.y - padding || heart.y > tree.lowerEdge + padding) return;
    const depth = THREE.MathUtils.clamp((heart.y - tree.top.y) / Math.max(1, tree.base.y - tree.top.y), 0, 1);
    const center = THREE.MathUtils.lerp(tree.top.x, tree.base.x, depth);
    const radius = THREE.MathUtils.lerp(tree.radius * 0.14, tree.radius, depth) + padding;
    if (Math.abs(heart.x - center) >= radius) return;
    const side = heart.x < center ? -1 : 1;
    heart.x = center + side * radius;
    heart.kickX = side * Math.max(0.47 * heart.size, Math.abs(heart.kickX));
}

function spawn(initial) {
    const random = Math.random;
    const unit = Math.min(width, height);
    const fromLeft = random() < 0.55;
    const size = THREE.MathUtils.clamp(unit * (0.024 + random() ** 1.6 * 0.043), 11, 56) * heartScale;
    const x = initial || !fromLeft ? random() * width : -size * 0.55;
    const y = initial || fromLeft ? random() * height : -size * 0.55;
    const heart = {
        x, y, size, kickX: 0, kickY: 0,
        vx: unit * (0.076 + random() * 0.074), vy: unit * (0.069 + random() * 0.070),
        angle: (random() - 0.5) * 0.70, phase: random() * Math.PI * 2,
        born: initial ? elapsed + 0.65 * (x / width + y / height) + random() * 0.24 : elapsed,
        tint: redsAndGold[Math.floor(random() * redsAndGold.length)],
    };
    particles.push(heart);
}

function separate(a, b) {
    const gap = (a.size + b.size) * 0.48;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const square = dx * dx + dy * dy;
    if (square >= gap * gap) return;
    const distance = Math.sqrt(square);
    const x = distance > 0.01 ? dx / distance : 1;
    const y = distance > 0.01 ? dy / distance : 0;
    const push = (gap - distance) * 0.49;
    a.x -= x * push;
    a.y -= y * push;
    b.x += x * push;
    b.y += y * push;
    const impact = Math.min(push * 3, gap * 0.85);
    a.kickX -= x * impact;
    a.kickY -= y * impact;
    b.kickX += x * impact;
    b.kickY += y * impact;
}

export function updateHearts(dt, view, group, environment) {
    const treeVisible = STATE.mode === 'TREE';
    if (!treeVisible) control = null;
    const holding = control !== null;
    if (!holding && !particles.length) {
        elapsed = 0;
        if (mesh) mesh.count = 0;
        return false;
    }
    if (!mesh) init(environment);
    resize();
    if (treeVisible) projectTree(view, group);

    const limit = reducedMotion.matches ? 53 : width < 600 ? 65 : CONFIG.activeQuality === 'low' ? 81 : maxHearts;
    if (holding) {
        if (!particles.length) {
            const initialCount = Math.round(limit * 0.60);
            for (let i = 0; i < initialCount; i++) spawn(true);
        }
        spawnCredit = particles.length < limit ? spawnCredit + dt * limit * 0.105 : 0;
        while (spawnCredit >= 1 && particles.length < limit) {
            spawn(false);
            spawnCredit--;
        }
    } else {
        spawnCredit = 0;
        // 松手之后，已经出现的继续移动，原先还在等出场的取消。
        for (let i = particles.length - 1; i >= 0; i--) {
            if (particles[i].born > elapsed) particles.splice(i, 1);
        }
    }

    elapsed += dt;

    const move = reducedMotion.matches ? dt * 0.35 : dt;
    const unit = Math.min(width, height);
    const damping = Math.exp(-5 * move);
    const wave = (heart) => elapsed * 2.7 - heart.x / width * 3.8 + heart.phase * 0.52;
    for (const heart of particles) {
        if (elapsed < heart.born) continue;
        const phase = wave(heart);
        const drift = Math.cos(phase) * (unit * 0.021 + heart.size * 0.42);
        const bob = Math.sin(phase) * (unit * 0.06 + heart.size * 0.78);
        heart.x += (heart.vx + heart.kickX + drift) * move;
        heart.y += (heart.vy + heart.kickY + bob) * move;
        heart.kickX *= damping;
        heart.kickY *= damping;
        if (treeVisible) avoidTree(heart);
    }

    const solid = particles.filter((heart) => elapsed - heart.born >= 0.22);
    for (let i = 0; i < solid.length; i++) {
        for (let j = i + 1; j < solid.length; j++) separate(solid[i], solid[j]);
        if (treeVisible) avoidTree(solid[i]);
    }

    let departed = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
        const heart = particles[i];
        const margin = heart.size;
        if (heart.x < -margin || heart.y < -margin || heart.x > width + margin || heart.y > height + margin) {
            particles.splice(i, 1);
            departed++;
        }
    }
    const replacements = holding ? Math.min(departed, limit - particles.length) : 0;
    for (let i = 0; i < replacements; i++) spawn(false);

    particles.forEach((heart, i) => {
        const grow = THREE.MathUtils.smoothstep(elapsed - heart.born, 0, 0.44);
        const scale = Math.max(0.001, heart.size * grow);
        dummy.position.set(heart.x - width / 2, height / 2 - heart.y, i * 0.1);
        const tilt = reducedMotion.matches ? heart.phase : wave(heart);
        dummy.rotation.set(0.18 + Math.sin(tilt) * 0.22, Math.cos(tilt) * 0.43, heart.angle + Math.sin(tilt * 0.7) * 0.17);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, heart.tint);
    });
    mesh.count = particles.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return holding || particles.length > 0;
}

export function renderHearts(renderer) {
    if (!mesh?.count) return;
    renderer.clearDepth();
    renderer.render(scene, camera);
}
