const remainingFingers = [9, 13, 17];

// 以像素等比坐标比较角度。镜像只会翻转 X，距离和夹角不变。
export function isPhotoFrame(hands, aspect) {
    if (hands.length !== 2) return false;
    const [a, b] = hands.map((landmarks) => describeFrameHand(landmarks, aspect));
    if (!a || !b) return false;

    const between = vector(a.wrist, b.wrist, aspect);
    const gap = length(between) / ((a.size + b.size) / 2);
    if (gap < 1.15 || gap > 8.5) return false;

    return cosine(a.index, b.index) < -0.55 && cosine(a.thumb, b.thumb) < -0.42
        && cosine(a.index, between) > 0.25 && cosine(b.index, between) < -0.25
        && cosine(a.thumb, between) > 0.26 && cosine(b.thumb, between) < -0.26;
}

function describeFrameHand(hand, aspect) {
    if (!hand || hand.length < 21) return null;
    const segment = (a, b) => vector(hand[a], hand[b], aspect);
    const extent = (a, b) => length(segment(a, b));
    const straightness = (first) => {
        const route = extent(first, first + 1) + extent(first + 1, first + 2) + extent(first + 2, first + 3);
        return route > 0 ? extent(first, first + 3) / route : 0;
    };
    const size = extent(0, 9);
    if (size < 0.028 || extent(4, 8) < size * 0.84) return null;

    const index = segment(5, 8);
    const thumb = segment(2, 4);
    const curled = remainingFingers.filter((first) => straightness(first) < 0.83);
    if (straightness(5) < 0.85 || straightness(1) < 0.77 || curled.length < 2) return null;
    if (length(index) < size * 0.54 || length(thumb) < size * 0.34) return null;
    if (Math.abs(cosine(index, thumb)) > 0.68) return null;

    return { wrist: hand[0], size, index, thumb };
}

function vector(a, b, aspect) {
    return { x: (b.x - a.x) * aspect, y: b.y - a.y };
}

function length(v) {
    return Math.hypot(v.x, v.y);
}

function cosine(a, b) {
    return (a.x * b.x + a.y * b.y) / (length(a) * length(b));
}
