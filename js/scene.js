/**
 * Three.js 场景搭建：渲染器、相机、灯光、环境贴图、Bloom 后期、鼠标轨道控制。
 *
 * 这里导出的 scene / camera / mainGroup 等是 ES Module 的 live binding，
 * 其他模块 import 后拿到的始终是 initScene() 赋值之后的实例。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { CONFIG, STATE } from './config.js';
import { damp } from './utils.js';
import { createFocusBlur } from './focus-blur.js';
import { renderHearts } from './heart-particles.js';

export let scene;
export let camera;
export let renderer;
export let composer;
export let controls;
export let wordFocusLayout;
/** 整棵树（装饰物 + 金尘 + 照片）都挂在这个 group 上，方便整体旋转。 */
export let mainGroup;

export const clock = new THREE.Clock();
const focusLayer = 1;
const foregroundMatrix = new THREE.Matrix4();
const foregroundColor = new THREE.Color();
let focusBlur;
let foreground;
let foregroundSource;

export function initScene() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.fog, 0.015);

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, CONFIG.camera.z);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.pixelRatio));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.2;
    container.appendChild(renderer.domElement);

    mainGroup = new THREE.Group();
    scene.add(mainGroup);

    setupEnvironment();
    setupLights();
    scene.traverse((object) => { if (object.isLight) object.layers.enable(focusLayer); });
    setupControls();
    setupPostProcessing();
    updateWordFocusLayout();

    window.addEventListener('resize', onResize);
}

function setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
}

function setupLights() {
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const innerLight = new THREE.PointLight(0xffaa00, 2, 20);
    innerLight.position.set(0, 5, 0);
    mainGroup.add(innerLight);

    const spotGold = new THREE.SpotLight(0xffcc66, 1200);
    spotGold.position.set(30, 40, 40);
    spotGold.angle = 0.5;
    spotGold.penumbra = 0.5;
    scene.add(spotGold);

    // 蓝色背光，营造月光感
    const spotBlue = new THREE.SpotLight(0x6688ff, 800);
    spotBlue.position.set(-30, 20, -30);
    scene.add(spotBlue);

    const fill = new THREE.DirectionalLight(0xffeebb, 0.8);
    fill.position.set(0, 0, 50);
    scene.add(fill);
}

/**
 * 鼠标 / 触摸控制。
 * 之前的版本 import 了 OrbitControls 却从未实例化，所以没有摄像头时整个项目是不能交互的。
 */
function setupControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = CONFIG.camera.minDistance;
    controls.maxDistance = CONFIG.camera.maxDistance;
    controls.target.set(0, 2, 0);

    // 用户拖拽时暂停树的自转，松手后恢复，避免两种旋转叠加导致晕眩。
    controls.addEventListener('start', () => { STATE.userControllingCamera = true; });
    controls.addEventListener('end', () => { STATE.userControllingCamera = false; });

    controls.update();
}

function setupPostProcessing() {
    // Bloom 在所有档位都保留：这套「香槟金辉光」是项目的整个视觉基调，
    // 关掉之后画面会立刻发灰发平。它的开销主要跟分辨率走，
    // 所以低配档是靠降 pixelRatio 和粒子数来省，而不是砍掉辉光。
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5, 0.4, 0.85
    );
    bloomPass.threshold = 0.65;
    bloomPass.strength = 0.5;
    bloomPass.radius = 0.4;

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloomPass);
    focusBlur = createFocusBlur();
    for (const pass of focusBlur) {
        pass.enabled = false;
        composer.addPass(pass);
    }
}

export function stageWordForeground(particle) {
    for (const pass of focusBlur) pass.enabled = Boolean(particle);
    if (!particle) return;

    const { mesh, index } = particle.instanced;
    if (foregroundSource !== mesh) {
        if (foreground) {
            scene.remove(foreground);
            foreground.dispose();
        }
        foreground = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
        foreground.layers.set(focusLayer);
        foreground.frustumCulled = false;
        foregroundSource = mesh;
        scene.add(foreground);
    }
    foregroundMatrix.multiplyMatrices(mainGroup.matrixWorld, particle.mesh.matrix);
    foreground.setMatrixAt(0, foregroundMatrix);
    foreground.instanceMatrix.needsUpdate = true;
    mesh.getColorAt(index, foregroundColor);
    foreground.setColorAt(0, foregroundColor);
    foreground.instanceColor.needsUpdate = true;
}

export function renderScene() {
    composer.render();
    const autoClear = renderer.autoClear;
    const background = scene.background;
    const layers = camera.layers.mask;
    renderer.autoClear = false;
    try {
        renderHearts(renderer);
        if (focusBlur[0].enabled) {
            scene.background = null;
            camera.layers.set(focusLayer);
            renderer.clearDepth();
            renderer.render(scene, camera);
        }
    } finally {
        camera.layers.mask = layers;
        scene.background = background;
        renderer.autoClear = autoClear;
    }
}

export function updateHandZoom(dt) {
    let target = 1;
    if (STATE.mode === 'SCATTER') {
        const size = STATE.hand.palmSize;
        if (size === null || STATE.userControllingCamera) return;
        const { farSize, nearSize, farZoom, nearZoom } = CONFIG.gestures.palmZoom;
        const progress = THREE.MathUtils.clamp((size - farSize) / (nearSize - farSize), 0, 1);
        target = THREE.MathUtils.lerp(farZoom, nearZoom, progress);
    }
    if (camera.zoom === target) return;
    camera.zoom = Math.abs(target - camera.zoom) < 0.001
        ? target
        : THREE.MathUtils.lerp(camera.zoom, target, damp(6, dt));
    camera.updateProjectionMatrix();
}

function updateWordFocusLayout() {
    const { innerWidth: width, innerHeight: height } = window;
    const desktopSpan = Math.min(height * 0.5, width * 0.52);
    const captionStart = width / 2 + THREE.MathUtils.clamp(width * 0.02, 18, 34);
    const captionLimit = width - 154 - 24; // 释义宽度和右侧留白
    const availableSpan = (captionLimit - captionStart) / 0.64;
    const stacked = availableSpan < Math.min(desktopSpan, 220);
    const span = stacked
        ? Math.min(height * (height <= 560 ? 0.37 : 0.44), width * 0.63)
        : Math.min(desktopSpan, availableSpan);
    const captionLeft = Math.min(captionLimit, captionStart + span * 0.64 + Math.min(width * 0.05, 90));
    wordFocusLayout = { x: 0.5, y: 0.5, heightRatio: span / height };

    document.body.style.setProperty('--word-caption-left', `${captionLeft}px`);
    for (const pass of focusBlur) pass.uniforms.viewport.value.set(width, height);
    document.body.classList.toggle('word-focus-stacked', stacked);
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    updateWordFocusLayout();
}
