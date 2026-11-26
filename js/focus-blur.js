import { Vector2 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

function createBlurPass(horizontal) {
    const pass = new ShaderPass({
        uniforms: {
            tDiffuse: { value: null },
            viewport: { value: new Vector2(1, 1) },
            resolution: { value: new Vector2(1, 1) },
            axis: { value: new Vector2(horizontal ? 1 : 0, horizontal ? 0 : 1) },
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D tDiffuse;
            uniform vec2 viewport;
            uniform vec2 resolution;
            uniform vec2 axis;
            varying vec2 vUv;

            vec3 samplePair(vec2 offset) {
                return texture2D(tDiffuse, vUv - offset).rgb + texture2D(tDiffuse, vUv + offset).rgb;
            }

            void main() {
                float distanceFromCenter = length((vUv - 0.5) * viewport);
                float rim = min(viewport.x, viewport.y) * 0.63;
                float softness = 1.0 - smoothstep(0.0, rim, distanceFromCenter);
                float sigma = mix(0.64, 5.6, softness);
                vec2 stride = axis / resolution;
                vec3 color = texture2D(tDiffuse, vUv).rgb;
                float total = 1.0;
                float weight = 1.0;
                float ratio = exp(-0.5 / (sigma * sigma));
                float decay = ratio * ratio;

                // 成对采样相邻像素，让高亮点连续虚化，避免出现网格状重影。
                for (int i = 1; i <= 11; i += 2) {
                    float first = weight * ratio;
                    ratio *= decay;
                    weight = first * ratio;
                    ratio *= decay;
                    float pair = first + weight;
                    color += samplePair(stride * (float(i) + weight / max(pair, 0.00001))) * pair;
                    total += 2.0 * pair;
                }

                gl_FragColor = vec4(color / total, 1.0);
                ${horizontal ? '' : `
                    gl_FragColor.rgb *= mix(0.93, 0.55, softness);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                `}
            }
        `,
    });
    pass.setSize = (width, height) => pass.uniforms.resolution.value.set(width, height);
    return pass;
}

export function createFocusBlur() {
    return [createBlurPass(true), createBlurPass(false)];
}
