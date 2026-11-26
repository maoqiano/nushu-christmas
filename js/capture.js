/**
 * 导出当前视口。WebGL 与摄像头保留点击时的一帧，其余内容沿用网页的布局和样式。
 */
import { renderScene, renderer } from './scene.js';

const svgNS = 'http://www.w3.org/2000/svg';
let embeddedFont;

export async function saveImage() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = renderer.getPixelRatio();
    const followCard = getFollowCard(width, height);
    const preview = isIOS() ? window.open('', '_blank') : null;

    try {
        // WebGL 的缓冲区需要在重绘后同步读取。随后再做字体和 PNG 编码。
        renderScene();
        const page = copyPage(width, height);
        page.prepend(await captureFont());

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        const layer = document.createElementNS(svgNS, 'foreignObject');
        layer.setAttribute('width', '100%');
        layer.setAttribute('height', '100%');
        layer.append(page);
        svg.append(layer);

        const [image, qr] = await Promise.all([
            renderPage(svg),
            loadImage(new URL('../assets/nushu-account-qr.jpg', import.meta.url), '无法读取关注二维码'),
        ]);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        const viewportHeight = Math.round(height * scale);
        canvas.height = viewportHeight + Math.round(followCard.extraHeight * scale);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, viewportHeight);
        if (followCard.extraHeight) {
            context.fillStyle = '#0d1625';
            context.fillRect(0, viewportHeight, canvas.width, canvas.height - viewportHeight);
        }
        context.scale(scale, scale);
        drawFollowCard(context, qr, followCard);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('浏览器无法生成截图');
        deliverImage(blob, preview);
        return true;
    } catch (error) {
        if (preview) preview.close();
        throw error;
    }
}

function getFollowCard(width, height) {
    const margin = Math.round(Math.max(10, Math.min(26, width * 0.022)));
    const padding = 12;
    const quietZone = 9;
    const gap = 15;
    const titleSize = width < 460 ? 18 : 20;
    const textWidth = titleSize * 4;
    const maxQrWidth = width - 2 * (margin + padding + quietZone) - textWidth - gap;
    const qrSize = Math.max(1, Math.round(Math.min(maxQrWidth, Math.max(112, Math.min(148, height * 0.16)))));
    const boxSize = qrSize + quietZone * 2;
    const cardWidth = padding * 2 + textWidth + gap + boxSize;
    const cardHeight = padding * 2 + boxSize;
    const x = width - margin - cardWidth;
    const bottomY = height - margin - cardHeight;

    // 窄屏留出底部空间，避免二维码压住挂件或文字对照。
    const caption = document.getElementById('word-caption');
    const bounds = caption.getBoundingClientRect();
    const coversCaption = !caption.hidden && getComputedStyle(caption).visibility === 'visible'
        && x < bounds.right && x + cardWidth > bounds.left && bottomY < bounds.bottom && height - margin > bounds.top;
    const extraHeight = width < 560 || coversCaption ? cardHeight + margin * 2 : 0;
    return { x, y: bottomY + extraHeight, width: cardWidth, height: cardHeight,
        qrSize, boxSize, quietZone, padding, titleSize, extraHeight };
}

function drawFollowCard(context, qr, card) {
    const { x, y, width, height, padding, qrSize, boxSize, quietZone, titleSize } = card;
    context.fillStyle = '#0d1625';
    context.strokeStyle = '#75613a';
    context.beginPath();
    context.roundRect(x, y, width, height, 8);
    context.fill();
    context.stroke();

    const qrX = x + width - padding - boxSize;
    context.fillStyle = '#fff';
    context.fillRect(qrX, y + padding, boxSize, boxSize);
    context.imageSmoothingEnabled = false;
    context.drawImage(qr, qrX + quietZone, y + padding + quietZone, qrSize, qrSize);

    const labelMiddle = y + height / 2;
    context.textBaseline = 'middle';
    context.fillStyle = '#fceea7';
    context.font = `600 ${titleSize}px "Songti SC", "PingFang SC", serif`;
    context.fillText('千年女书', x + padding, labelMiddle - 13);
    context.fillText('欢迎关注', x + padding, labelMiddle + 13);
}

function copyPage(width, height) {
    const copy = document.createElement('div');
    copyStyle(getComputedStyle(document.body), copy.style);
    Object.assign(copy.style, {
        position: 'relative',
        width: width + 'px',
        height: height + 'px',
        margin: '0',
        overflow: 'hidden',
    });
    copyChildren(document.body, copy);
    return copy;
}

function copyChildren(source, clone) {
    for (const node of source.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) clone.append(node.cloneNode());
        else if (node instanceof Element && node.tagName !== 'SCRIPT') {
            const child = captureElement(node);
            if (child) clone.append(child);
        }
    }
}

function captureElement(element) {
    if (element.hasAttribute('data-capture-hidden')) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;

    if (element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement) {
        const frame = captureFrame(element);
        if (!frame) return null;
        const image = document.createElement('img');
        image.src = frame;
        copyStyle(style, image.style);
        return image;
    }

    const copy = element.cloneNode(false);
    copyStyle(style, copy.style);
    copyChildren(element, copy);
    return copy;
}

function copyStyle(source, target) {
    for (let i = 0; i < source.length; i++) {
        const name = source.item(i);
        target.setProperty(name, source.getPropertyValue(name));
    }
    // 计算样式已经包含点击这一刻的状态。
    target.animation = 'none';
    target.transition = 'none';
}

function captureFrame(element) {
    if (element instanceof HTMLCanvasElement) return element.toDataURL('image/png');
    if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !element.videoWidth) return null;

    const frame = document.createElement('canvas');
    frame.width = element.videoWidth;
    frame.height = element.videoHeight;
    frame.getContext('2d').drawImage(element, 0, 0);
    return frame.toDataURL('image/png');
}

async function captureFont() {
    const style = document.createElement('style');
    // SVG 图片不能从页面外部加载字体，嵌入和标题一致的本地字体。
    embeddedFont ??= fetch(new URL('../assets/cinzel-latin.woff2', import.meta.url))
        .then((response) => response.ok ? response.blob() : null)
        .then((blob) => blob ? readDataURL(blob) : '')
        .catch(() => '');
    const font = await embeddedFont;
    if (font) {
        style.textContent = '@font-face{font-family:Cinzel;src:url(' + font + ') format("woff2");font-weight:400 900}';
    }
    return style;
}

function readDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function renderPage(svg) {
    const xml = new XMLSerializer().serializeToString(svg);
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml), '无法渲染网页截图');
}

function loadImage(source, errorMessage) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(errorMessage));
        image.src = source;
    });
}

function deliverImage(blob, preview) {
    const url = URL.createObjectURL(blob);
    if (preview && !preview.closed) {
        preview.location.href = url;
    } else {
        const link = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        link.download = 'christmas-page-' + stamp + '.png';
        link.href = url;
        link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function isIOS() {
    // iPadOS 可使用 Mac 桌面标识，触屏点数可识别这类设备。
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
