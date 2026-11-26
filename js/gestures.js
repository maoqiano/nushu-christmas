/**
 * MediaPipe 手势识别。
 *
 * 设计前提：这一整块都是「锦上添花」。没有摄像头、用户拒绝授权、CDN 连不上，
 * 都只会让手势失效，绝不能影响 3D 场景的渲染 —— 旧版本把 `await initMediaPipe()`
 * 放在 init() 里且没有兜底，模型下载一失败就永远停在 loading 界面。
 */
import { CONFIG, STATE } from './config.js';
import { focusNushu, focusPhoto } from './focus.js';
import { isPhotoFrame } from './frame-gesture.js';
import { isFingerHeart } from './finger-heart.js';
import { setHeartGesture } from './heart-particles.js';
import { setStatus, setDebug } from './ui.js';

const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL_PATH =
    new URL('../vendor/mediapipe/hand_landmarker.task', import.meta.url).href;

const MODE_LABEL = {
    TREE: '握拳 · 聚成树',
    SCATTER: '张开 · 前后缩放，左右转动',
};
const HEART_LABEL = '指尖比心 · 爱心飘落';

// 连续出错多少帧才提示用户（偶发单帧失败不值得打扰）
const ERROR_LIMIT = 30;

let handLandmarker = null;
let video = null;
let lastVideoTime = -1;
let consecutiveErrors = 0;
let pendingGesture = null;
let pendingSince = 0;
let latchedGesture = null;
let pinchAnchor = null;
let lastHeartSeen = null;

/** @returns {Promise<boolean>} 手势是否成功启用 */
export async function initGestures() {
    video = document.getElementById('webcam');

    if (!navigator.mediaDevices?.getUserMedia) {
        disableWebcamUI('此浏览器不支持摄像头 · 鼠标仍可操作');
        return false;
    }

    try {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numHands: 2,
        });
    } catch (err) {
        console.warn('[tree] 手势模型加载失败，仅鼠标模式可用', err);
        disableWebcamUI('手势模型加载失败 · 鼠标仍可操作');
        return false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        });
        video.addEventListener('loadeddata', predictWebcam, { once: true });
        video.srcObject = stream;
        setStatus('摄像头已开启，伸手试试');
        return true;
    } catch (err) {
        console.warn('[tree] 摄像头不可用', err);
        if (err.name === 'NotAllowedError') {
            disableWebcamUI('请在浏览器的网站设置中允许本页使用摄像头，然后刷新。', true);
        } else {
            disableWebcamUI('摄像头不可用 · 鼠标仍可操作');
        }
        return false;
    }
}

function disableWebcamUI(message, permissionDenied = false) {
    const wrapper = document.getElementById('webcam-wrapper');
    if (permissionDenied) wrapper.classList.add('camera-permission-denied');
    else wrapper.style.display = 'none';
    setStatus(message);
}

function predictWebcam() {
    // rAF 必须排在最前：一旦 detectForVideo 抛错（video 尚未就绪、GPU 上下文
    // 丢失、ROI 异常），循环就再也排不上队，手势会在余下的整个会话里静默失效。
    requestAnimationFrame(predictWebcam);

    const now = performance.now();
    if (!handLandmarker || video.currentTime === lastVideoTime) {
        releaseLostHeart(now);
        return;
    }
    lastVideoTime = video.currentTime;

    try {
        processGestures(handLandmarker.detectForVideo(video, now), video.videoWidth / video.videoHeight, now);
    } catch (err) {
        // 偶发一帧失败无所谓，下一帧再来；连续失败才值得提醒
        STATE.hand.palmSize = null;
        releaseLostHeart(now);
        if (++consecutiveErrors === ERROR_LIMIT) {
            console.warn(`[tree] 手势识别连续 ${ERROR_LIMIT} 帧出错，已降级为鼠标操作`, err);
            setStatus('手势识别异常 · 鼠标仍可操作');
        }
        return;
    }

    consecutiveErrors = 0;
}

/**
 * 用「相对比例」而非绝对像素距离判定手势，
 * 这样手离摄像头远近不同也能稳定识别。
 */
export function processGestures(result, aspect, now) {
    const hands = result.landmarks ?? [];
    STATE.hand.palmSize = null;
    if (!hands.length) {
        STATE.hand.detected = false;
        pinchAnchor = null;
        applyGesture(null, now);
        setStatus(latchedGesture === 'heart' ? HEART_LABEL : '未检测到手');
        setDebug('—');
        return;
    }

    const g = CONFIG.gestures;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const lm = hands.reduce((nearest, hand) => distance(hand[0], hand[9]) > distance(nearest[0], nearest[9]) ? hand : nearest);
    const wrist = lm[0];
    const middleMCP = lm[9];   // 中指指根

    // 以「手腕→中指指根」为基准长度，抵消远近带来的尺度差异。
    // 这道门槛必须在写 STATE.hand 之前：手太小说明人离得很远或识别不稳，
    // 此时的坐标抖得厉害，一旦写进去就会直接甩动 SCATTER 模式下的视角。
    const handSize = distance(middleMCP, wrist);
    if (handSize < g.minHandSize) {
        STATE.hand.detected = false;
        pinchAnchor = null;
        applyGesture(null, now);
        return;
    }

    STATE.hand.detected = true;

    // 取负号做镜像：预览画面用 CSS scaleX(-1) 翻转过（照镜子的直觉），
    // 而 MediaPipe 给的是未翻转的原始坐标。不翻的话，用户看着预览里手往右移，
    // 树却往反方向转 —— 画面和操作对不上。
    STATE.hand.x = -(middleMCP.x - 0.5) * 2;
    STATE.hand.y = (middleMCP.y - 0.5) * 2;

    const tips = [lm[8], lm[12], lm[16], lm[20]];
    const avgTipDist =
        tips.reduce((sum, t) => sum + distance(t, wrist), 0) / tips.length;

    const extensionRatio = avgTipDist / handSize;
    const pinchRatio = distance(lm[4], lm[8]) / handSize;
    const framing = isPhotoFrame(hands, aspect);
    const heart = !framing && hands.some((hand) =>
        distance(hand[0], hand[9]) >= g.minHandSize && isFingerHeart(hand, aspect),
    );

    setDebug(
        `size ${handSize.toFixed(3)} · ext ${extensionRatio.toFixed(2)} · pinch ${pinchRatio.toFixed(2)} · 取景 ${framing ? '✓' : '—'} · 比心 ${heart ? '✓' : '—'}`
    );

    const extendedPinch = distance(lm[8], lm[5]) > handSize * 0.36
        && distance(lm[8], lm[9]) > handSize * 0.61;
    let gesture = null;
    if (framing) gesture = 'frame';
    else if (heart) gesture = 'heart';
    else if (pinchRatio < g.pinchRatio * (latchedGesture === 'pinch' ? 1.22 : 1)
        && (extensionRatio >= g.fistExtensionRatio || extendedPinch)) gesture = 'pinch';
    else if (extensionRatio < g.fistExtensionRatio) gesture = 'TREE';
    else if (extensionRatio > g.openExtensionRatio) {
        gesture = 'SCATTER';
        // 以画面高度为单位，保持横屏与竖屏的手掌尺度一致。
        STATE.hand.palmSize = Math.hypot((middleMCP.x - wrist.x) * aspect, middleMCP.y - wrist.y);
    }

    applyGesture(gesture, now);
    if (gesture === 'pinch' && latchedGesture === 'pinch' && STATE.focusTarget?.userData.nushu) {
        const { x, y } = STATE.hand;
        pinchAnchor ??= { x, y };
        STATE.focusRotation.yaw = (x - pinchAnchor.x) * Math.PI * 1.75;
        STATE.focusRotation.pitch = Math.max(-0.85, Math.min(0.85, (y - pinchAnchor.y) * 2.1));
    } else {
        pinchAnchor = null;
    }
    const focusLabel = STATE.focusTarget?.name ? `女书 · ${STATE.focusTarget.name}` : '双手取景 · 看照片';
    setStatus(latchedGesture === 'heart' ? HEART_LABEL : STATE.mode === 'FOCUS' ? focusLabel : MODE_LABEL[STATE.mode]);
}

function applyGesture(gesture, now) {
    const { frameHoldMs, pinchHoldMs, heartHoldMs, heartTrackingGapMs, heartReleaseMs } = CONFIG.gestures;
    if (gesture === 'heart') {
        lastHeartSeen = now;
    } else {
        releaseLostHeart(now);
        if ((gesture === null || gesture === 'TREE') && lastHeartSeen !== null) {
            // 交叉的指尖偶尔会短暂丢失，或被判成握拳。让稳定的比心跨过这段抖动。
            const grace = latchedGesture === 'heart' ? heartReleaseMs : heartTrackingGapMs;
            if (now - lastHeartSeen <= grace) return;
        }
    }

    if (gesture !== pendingGesture) {
        pendingGesture = gesture;
        pendingSince = now;
    }
    const held = now - pendingSince;
    if (!gesture) {
        if (held >= 110) latchedGesture = null;
        return;
    }
    if (gesture === latchedGesture) return;

    const thresholds = { frame: frameHoldMs, pinch: pinchHoldMs, heart: heartHoldMs };
    const leavingWord = STATE.mode === 'FOCUS' && STATE.focusTarget?.userData.nushu;
    const threshold = thresholds[gesture] ?? (leavingWord ? 230 : 85);
    if (held < threshold) return;

    if (gesture === 'frame') {
        if (focusPhoto()) latchedGesture = gesture;
    } else if (gesture === 'pinch') {
        if (focusNushu()) latchedGesture = gesture;
    } else if (gesture === 'heart') {
        setHeartGesture(true);
        latchedGesture = gesture;
    } else {
        STATE.mode = gesture;
        STATE.focusTarget = null;
        latchedGesture = gesture;
    }
}

function releaseLostHeart(now) {
    if (lastHeartSeen === null || now - lastHeartSeen < CONFIG.gestures.heartReleaseMs) return;
    lastHeartSeen = null;
    setHeartGesture(false);
    if (latchedGesture === 'heart') latchedGesture = null;
    if (pendingGesture === 'heart') pendingGesture = null;
}
