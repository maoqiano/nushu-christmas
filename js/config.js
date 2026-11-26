/**
 * 全局配置与运行时状态。
 * 想调效果基本只改这一个文件就够了。
 */

export const CONFIG = {
    colors: {
        bg: 0x050d1a,            // 深邃午夜蓝
        fog: 0x050d1a,
        champagneGold: 0xffd966,
        deepGreen: 0x03180a,
        accentRed: 0x990000,
    },

    /**
     * 粒子数量按设备能力分档。
     * 全部装饰物 + 金尘都走 InstancedMesh，所以数量再大也只有个位数 draw call，
     * 真正的瓶颈是每帧要在 JS 里合成多少个矩阵 —— 手机上降档就是降这个。
     */
    quality: {
        high:   { count: 1500, dustCount: 2000, snowCount: 1000, pixelRatio: 2 },
        medium: { count: 1000, dustCount: 1200, snowCount: 600,  pixelRatio: 1.5 },
        low:    { count: 700,  dustCount: 700,  snowCount: 400,  pixelRatio: 1 },
    },

    particles: {
        // count / dustCount / snowCount 由 applyQuality() 在启动时按设备填入
        treeHeight: 24,
        treeRadius: 8,
        nushuFraction: 0.4,
        sphereRetention: 0.84,
        nushuScaleVariation: 1.30,
        nushuMaterialFraction: 0.70,
    },

    render: {
        // pixelRatio 同样由 applyQuality() 填入
    },

    camera: {
        z: 50,
        minDistance: 15,
        maxDistance: 120,
    },

    photos: {
        mountClearance: 1,
        slots: [
            {
                orientation: 'portrait', mountHeight: 0.45, mountAngle: 0.45, placeholderAspect: 2 / 3,
                fallbackImage: './assets/nushu-photos/P1.jpg',
            },
            {
                orientation: 'portrait', mountHeight: 0.61, mountAngle: -0.43, placeholderAspect: 2 / 3,
                fallbackImage: './assets/nushu-photos/P2.jpg',
            },
            {
                orientation: 'landscape', mountHeight: 0.39, mountAngle: -0.52, placeholderAspect: 3 / 2,
                fallbackImage: './assets/nushu-photos/H2.jpg',
            },
            {
                orientation: 'landscape', mountHeight: 0.28, mountAngle: 0.49, placeholderAspect: 3 / 2,
                fallbackImage: './assets/nushu-photos/H3.jpg',
            },
        ],
    },

    preload: {
        /**
         * 把照片放进 ./images/，再建一个 images/manifest.json 列出文件名即可自动加载。
         * 参考 images/manifest.example.json。没有这个文件就静默跳过 —— 不会产生 404 刷屏。
         */
        manifest: './images/manifest.json',
    },

    gestures: {
        fistExtensionRatio: 1.5,   // 低于此值判定为握拳
        openExtensionRatio: 1.7,   // 高于此值判定为张开
        pinchRatio: 0.35,          // 低于此值判定为捏合
        minHandSize: 0.02,         // 手太小（太远）时忽略，避免抖动
        frameHoldMs: 170,
        pinchHoldMs: 100,
        heartHoldMs: 180,
        heartTrackingGapMs: 115,
        heartReleaseMs: 240,
        palmZoom: { farSize: 0.08, nearSize: 0.27, farZoom: 0.76, nearZoom: 1.68 },
    },
};

/** 运行时状态，模块之间共享读写。 */
export const STATE = {
    mode: 'TREE',                  // TREE | SCATTER | FOCUS
    focusTarget: null,
    focusRotation: { yaw: 0, pitch: 0 },
    hand: { detected: false, x: 0, y: 0, palmSize: null },
    rotation: { x: 0, y: 0 },
    userControllingCamera: false,  // 鼠标拖拽期间暂停自转
};

/**
 * 按设备能力挑一档画质，并把结果写回 CONFIG.particles。
 *
 * 判断依据有意保守：手机上跑满 1500 个装饰物 + 2000 粒金尘 + Bloom 会直接掉到
 * 十几帧，宁可少一点也要保证顺滑 —— 卡顿比粒子少更劝退。
 * 想强制某一档可以加 URL 参数：?quality=high|medium|low
 */
export function applyQuality() {
    const forced = new URLSearchParams(location.search).get('quality');
    // 必须用 hasOwnProperty：CONFIG.quality 是普通对象字面量，?quality=toString
    // 之类会顺着原型链取到函数，通过真值判断后解构出一堆 undefined，
    // 最终 setPixelRatio(NaN) 把画布尺寸变成 0，用户看到的是一片空白。
    const valid = forced !== null && Object.prototype.hasOwnProperty.call(CONFIG.quality, forced);
    const tier = valid ? forced : detectTier();

    const { count, dustCount, snowCount, pixelRatio } = CONFIG.quality[tier];
    Object.assign(CONFIG.particles, { count, dustCount, snowCount });
    Object.assign(CONFIG.render, { pixelRatio });
    CONFIG.activeQuality = tier;

    return tier;
}

function detectTier() {
    // 粗略指针 = 触摸屏，基本等同于手机 / 平板
    const isTouch = window.matchMedia?.('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const narrow = Math.min(window.innerWidth, window.innerHeight) < 500;

    if (isTouch && (narrow || cores <= 4)) return 'low';
    if (isTouch || cores <= 4) return 'medium';
    return 'high';
}
