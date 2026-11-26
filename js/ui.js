/**
 * 界面：加载遮罩、上传按钮、首次引导、保存图片、快捷键、状态条。
 */
import { STATE } from './config.js';
import { handleImageUpload } from './photos.js';
import { saveImage } from './capture.js';
import { isDemoMode } from './demo.js';
import { focusNushu, focusPhoto } from './focus.js';
import { glyphOutlines } from './nushu-outlines.js';
import { toggleHeartPreview } from './heart-particles.js';

const SEEN_KEY = 'grand-luxury-tree:onboarded';
const SVG_NS = 'http://www.w3.org/2000/svg';

let statusEl = null;
let debugEl = null;
let onboardingEl = null;
let wordCaption;
let wordGlyphs;
let wordTranslation;
let focusedWord = null;

export function initUI() {
    statusEl = document.getElementById('status-info');
    debugEl = document.getElementById('debug-info');
    onboardingEl = document.getElementById('onboarding');
    wordCaption = document.getElementById('word-caption');
    wordGlyphs = document.getElementById('word-glyphs');
    wordTranslation = document.getElementById('word-translation');

    const photoInput = document.getElementById('file-input');
    photoInput.addEventListener('change', handleImageUpload);
    document.getElementById('photo-btn').addEventListener('click', () => photoInput.click());
    document.getElementById('save-btn').addEventListener('click', onSave);
    document.getElementById('help-btn').addEventListener('click', () => toggleOnboarding(true));
    document.getElementById('onboarding-close').addEventListener('click', () => toggleOnboarding(false));

    window.addEventListener('keydown', onKeyDown);

    if (!isDemoMode() && !hasSeenOnboarding()) toggleOnboarding(true);
}

export function updateFocusUI(heartsVisible) {
    document.body.classList.toggle('scene-interacting', STATE.mode !== 'TREE' || heartsVisible);
    const nushu = STATE.mode === 'FOCUS' ? STATE.focusTarget?.userData.nushu ?? null : null;
    if (focusedWord === nushu) return;
    focusedWord = nushu;

    if (nushu) {
        const outlines = glyphOutlines[nushu.fontWeight];
        wordGlyphs.replaceChildren(...Array.from(nushu.word, (character) => renderGlyph(outlines[character])));
        wordTranslation.textContent = nushu.word;
    }
    wordCaption.hidden = !nushu;
}

function renderGlyph(outline) {
    const glyph = document.createElementNS(SVG_NS, 'svg');
    glyph.setAttribute('viewBox', '-0.34 -0.88 0.68 0.92');
    glyph.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', outline);
    path.setAttribute('transform', 'scale(1 -1)');
    glyph.append(path);
    return glyph;
}

/* ---------- 首次引导 ---------- */

function hasSeenOnboarding() {
    // 隐私模式下 localStorage 会直接抛异常，读不到就当没看过，无伤大雅
    try {
        return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
        return false;
    }
}

function toggleOnboarding(show) {
    if (!onboardingEl) return;
    onboardingEl.hidden = !show;

    if (show) return;
    try {
        localStorage.setItem(SEEN_KEY, '1');
    } catch {
        // 存不下就算了，下次再弹一遍也不是什么大问题
    }
}

/* ---------- 保存图片 ---------- */

async function onSave(e) {
    const btn = e.currentTarget;
    const label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');

    try {
        const ok = await saveImage();
        btn.textContent = ok ? '已截图' : '截图失败';
    } catch (err) {
        console.error('[tree] 保存图片失败', err);
        btn.textContent = '截图失败';
    }

    setTimeout(() => {
        btn.textContent = label;
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
    }, 1600);
}

/* ---------- 快捷键 ---------- */

function onKeyDown(e) {
    // 在输入框里打字时不触发快捷键
    if (e.target instanceof HTMLInputElement) return;
    // 放过一切组合键：Cmd/Ctrl+S 是「保存网页」，不该把树炸开；
    // Cmd+H 是 macOS 的隐藏窗口，Ctrl+D 是加书签，都不该被我们截胡。
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // 演示模式接管了形态切换，按键掺和进来只会打架
    if (isDemoMode()) return;

    if (e.key === 'Escape') {
        toggleOnboarding(false);
        return;
    }

    switch (e.key.toLowerCase()) {
        case 'h':
            // 隐藏全部 UI，方便截图 / 录屏当壁纸
            document.body.classList.toggle('ui-hidden-all');
            break;
        case 'd':
            // 手势调试数值默认藏起来，需要调阈值时按 D 打开
            document.body.classList.toggle('debug-visible');
            break;
        case 't':
            STATE.mode = 'TREE';
            STATE.focusTarget = null;
            break;
        case 's':
            STATE.mode = 'SCATTER';
            STATE.focusTarget = null;
            break;
        case 'f':
            if (!e.repeat) focusNushu();
            break;
        case 'p':
            if (!e.repeat) focusPhoto();
            break;
        case 'l':
            if (!e.repeat) toggleHeartPreview();
            break;
    }
}

/* ---------- 状态显示 ---------- */

/** 面向用户的一行提示。 */
export function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

/** 手势原始数值，只有按过 D 才可见。 */
export function setDebug(text) {
    if (debugEl) debugEl.textContent = text;
}

export function hideLoader() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.style.opacity = '0';
    setTimeout(() => loader.remove(), 800);
}
