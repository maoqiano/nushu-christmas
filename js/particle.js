/**
 * 单个粒子的行为：在「树形」「散开」「聚焦」三种目标位置之间插值。
 */
import * as THREE from 'three';
import { CONFIG, STATE } from './config.js';
import { camera, mainGroup, clock, controls, wordFocusLayout, stageWordForeground } from './scene.js';
import { damp, reducedMotion } from './utils.js';

/**
 * 复用的临时对象。
 * 缓存缩放向量，以及聚焦时相机位置和聚焦落点在树坐标系中的位置。
 */
const _tmpScale = new THREE.Vector3();
const _cameraInGroup = new THREE.Vector3();
const _focusPosition = new THREE.Vector3();
const _hiddenInstance = new THREE.Matrix4().makeScale(0, 0, 0);
const _localPhotoFocus = new THREE.Vector3();
let focusSpan = 1;

export const particleSystem = [];

/** 所有 InstancedMesh，每帧统一置一次 needsUpdate。 */
export const instancedMeshes = [];

export function registerInstancedMesh(mesh) {
    instancedMeshes.push(mesh);
    return mesh;
}

export class Particle {
    /**
     * @param {THREE.Object3D} mesh
     *   照片是真正在场景图里的 Group；装饰物和金尘则是**游离的 Object3D**
     *   —— 它不进场景图，只当一个持久的变换容器（位置 / 旋转 / 缩放），
     *   每帧把合成好的矩阵写进对应 InstancedMesh 的第 index 个实例。
     *   同类粒子共用几何和材质，减少渲染提交。
     * @param {{mesh: THREE.InstancedMesh, index: number} | null} instanced
     */
    constructor(mesh, type, isDust = false, instanced = null) {
        this.mesh = mesh;
        this.type = type;
        this.isDust = isDust;
        this.instanced = instanced;

        this.posTree = new THREE.Vector3();
        this.posScatter = new THREE.Vector3();
        this.baseScale = mesh.scale.x;
        this.wordWorldPosition = null;
        this.wordYaw = 0;
        this.wordPitch = 0;

        const speedMult = type === 'PHOTO' ? 0.3 : 2.0;
        this.spinSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult
        );

        this.calculatePositions();
    }

    calculatePositions() {
        this.randomizeScatterPosition(this.isDust ? 12 : 8, this.isDust ? 20 : 12);

        if (this.type === 'PHOTO') {
            // 照片位置由 photos.js 设置到树身的预留位置。
            this.posTree.set(0, 0, 0);
            return;
        }

        this.randomizeTreePosition();
    }

    randomizeTreePosition() {
        const h = CONFIG.particles.treeHeight;
        let t = Math.pow(Math.random(), 0.8);
        const y = t * h - h / 2;

        const rMax = Math.max(CONFIG.particles.treeRadius * (1.0 - t), 0.5);
        // 词语从树身各方向穿插分布，减少同一条螺旋上的遮挡。
        const angle = this.type === 'NUSHU'
            ? Math.random() * Math.PI * 2
            : t * 50 * Math.PI + Math.random() * Math.PI;
        const r = rMax * (0.8 + Math.random() * 0.4);

        this.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    }

    /** 在一个球壳里均匀取点，作为散开时的位置。 */
    randomizeScatterPosition(minR, spread) {
        const r = minR + Math.random() * spread;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.posScatter.set(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );
    }

    update(dt, mode, focusTargetMesh) {
        const isFocused = mode === 'FOCUS' && this.mesh === focusTargetMesh;
        const isForeground = isFocused && this.type === 'NUSHU';

        if (isForeground) {
            if (!this.wordWorldPosition) {
                this.wordWorldPosition = mainGroup.localToWorld(this.mesh.position.clone());
                this.wordYaw = 0;
                this.wordPitch = 0;
            }
            // 在世界坐标中插值，让背景自转时挂件仍能稳在取景位置。
            this.wordWorldPosition.lerp(_focusPosition, damp(5.5, dt));
            mainGroup.worldToLocal(this.mesh.position.copy(this.wordWorldPosition));
        } else {
            this.wordWorldPosition = null;
            const target = isFocused ? _localPhotoFocus : mode === 'TREE' ? this.posTree : this.posScatter;
            this.mesh.position.lerp(target, damp(isFocused ? 5 : 2, dt));
        }

        if (isFocused) {
            this.mesh.lookAt(this.instanced ? _cameraInGroup : camera.position);
            if (isForeground) {
                const smoothing = damp(9, dt);
                const yaw = this.mesh.userData.nushu.form === 'upright'
                    ? THREE.MathUtils.clamp(STATE.focusRotation.yaw, -0.96, 0.92)
                    : STATE.focusRotation.yaw;
                this.wordYaw = THREE.MathUtils.lerp(this.wordYaw, yaw, smoothing);
                this.wordPitch = THREE.MathUtils.lerp(this.wordPitch, STATE.focusRotation.pitch, smoothing);
                this.mesh.rotateY(0.26 + this.wordYaw);
                this.mesh.rotateX(this.wordPitch);
            }
        } else if (mode === 'SCATTER') {
            this.mesh.rotation.x += this.spinSpeed.x * dt;
            this.mesh.rotation.y += this.spinSpeed.y * dt;
            this.mesh.rotation.z += this.spinSpeed.z * dt;
        } else if (mode === 'TREE') {
            if (this.type === 'PHOTO') {
                this.mesh.lookAt(0, this.mesh.position.y, 0);
                this.mesh.rotateY(Math.PI);
            } else if (this.type === 'NUSHU') {
                // 竖排文字略偏向一侧，多面挂件绕纵轴慢转以露出其他字面。
                this.mesh.lookAt(_cameraInGroup);
                const direction = this.spinSpeed.y < 0 ? -1 : 1;
                const form = this.instanced.mesh.geometry.userData.form;
                const rotation = form !== 'upright' && !reducedMotion.matches ? clock.elapsedTime * 0.34 : 0;
                this.mesh.rotateY(direction * (0.22 + rotation));
            } else {
                const k = damp(1.0, dt);
                this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, k);
                this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, k);
                this.mesh.rotation.y += 0.5 * dt;
            }
        }

        this.mesh.scale.lerp(_tmpScale.setScalar(this.targetScale(mode, isFocused)), damp(4, dt));

        if (this.instanced) {
            this.mesh.updateMatrix();
            this.instanced.mesh.setMatrixAt(this.instanced.index, isForeground ? _hiddenInstance : this.mesh.matrix);
        }
    }

    targetScale(mode, isFocused) {
        if (isFocused) {
            if (this.type === 'PHOTO') return focusSpan / this.mesh.userData.focusSpan;
            const { min, max } = this.instanced.mesh.geometry.boundingBox;
            const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
            return focusSpan / span;
        }
        if (this.isDust) {
            // 金尘只在散开时出现，聚成树时缩到 0 藏起来
            if (mode === 'TREE') return 0;
            return this.baseScale * (0.8 + 0.4 * Math.sin(clock.elapsedTime * 4 + this.mesh.id));
        }
        if (mode === 'SCATTER' && this.type === 'PHOTO') return this.baseScale * 2.5;
        if (mode === 'FOCUS') return this.baseScale * 0.8;
        return this.baseScale;
    }
}

/** 每帧更新全部粒子，最后统一提交实例矩阵。 */
export function updateParticles(dt, mode, focusTarget) {
    if (mode === 'TREE' || mode === 'FOCUS') {
        mainGroup.worldToLocal(_cameraInGroup.copy(camera.position));
    }
    if (mode === 'FOCUS' && focusTarget) {
        const distance = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.32, 6, 17);
        camera.getWorldDirection(_focusPosition).multiplyScalar(distance).add(camera.position);
        const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2));
        const word = focusTarget.userData.nushu;
        if (word) {
            // 相机的光轴和径向模糊都以视口中央为中心。
            focusSpan = height * wordFocusLayout.heightRatio * (word.form === 'faceted' ? 0.86 : 1);
        } else {
            focusSpan = height * Math.min(0.55, camera.aspect * 0.76);
            mainGroup.worldToLocal(_localPhotoFocus.copy(_focusPosition));
        }
    }
    let foreground = null;
    for (const p of particleSystem) {
        p.update(dt, mode, focusTarget);
        if (mode === 'FOCUS' && p.mesh === focusTarget && p.type === 'NUSHU') foreground = p;
    }
    for (const m of instancedMeshes) m.instanceMatrix.needsUpdate = true;
    stageWordForeground(foreground);
}
