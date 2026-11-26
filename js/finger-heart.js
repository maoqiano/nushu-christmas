// 比心时拇指和食指的中段交叉，两个指尖继续伸出。普通捏合只在指尖接触。
export function isFingerHeart(hand, aspect) {
    const point = (i) => ({ x: hand[i].x * aspect, y: hand[i].y });
    const delta = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
    const length = (v) => Math.hypot(v.x, v.y);
    const span = (a, b) => length(delta(point(a), point(b)));
    const cross = (a, b) => a.x * b.y - a.y * b.x;

    const palm = span(0, 9);
    const tips = span(4, 8);
    if (tips < palm * 0.40 || tips > palm * 1.47) return false;

    const thumb = delta(point(2), point(4));
    const index = delta(point(6), point(8));
    const area = cross(thumb, index);
    if (length(thumb) < palm * 0.54 || length(index) < palm * 0.46) return false;
    if (Math.abs(area) < length(thumb) * length(index) * 0.56) return false;

    const offset = delta(point(2), point(6));
    const alongThumb = cross(offset, index) / area;
    const alongIndex = cross(offset, thumb) / area;
    if (alongThumb < -0.12 || alongThumb > 0.81 || alongIndex < 0.06 || alongIndex > 0.85) return false;

    return [9, 13, 17].every((base) => {
        const route = span(base, base + 1) + span(base + 1, base + 2) + span(base + 2, base + 3);
        return span(base, base + 3) < route * 0.85;
    });
}
