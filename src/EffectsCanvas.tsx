import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface EffectsCanvasProps {
  video: HTMLVideoElement | null
  boxRef: React.MutableRefObject<[number, number, number, number]>
  effectIndex: number
}

export default function EffectsCanvas({ video, boxRef, effectIndex }: EffectsCanvasProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const textureRef = useRef<THREE.VideoTexture | null>(null)
  const { size } = useThree()

  useEffect(() => {
    if (!materialRef.current || !video) return

    const updateTexture = () => {
      if (!materialRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

      textureRef.current?.dispose()

      const texture = new THREE.VideoTexture(video)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter

      textureRef.current = texture
      materialRef.current.uniforms.uTexture.value = texture
    }

    updateTexture()
    video.addEventListener('loadeddata', updateTexture)

    return () => {
      video.removeEventListener('loadeddata', updateTexture)
      textureRef.current?.dispose()
      textureRef.current = null
    }
  }, [video])

  useFrame((state) => {
    if (!materialRef.current) return

    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
    materialRef.current.uniforms.uBox.value.set(
      boxRef.current[0],
      boxRef.current[1],
      boxRef.current[2],
      boxRef.current[3],
    )
    materialRef.current.uniforms.uEffect.value = effectIndex
    materialRef.current.uniforms.uResolution.value.set(size.width, size.height)
  })

  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `

  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform vec4 uBox;
    uniform float uEffect;
    uniform vec2 uResolution;
    varying vec2 vUv;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m;
      m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 uv = vec2(1.0 - vUv.x, vUv.y);
      vec4 baseColor = texture2D(uTexture, uv);

      bool insideBox = uv.x >= uBox.x && uv.x <= uBox.z && uv.y >= uBox.y && uv.y <= uBox.w;
      bool hasBox = uBox.z > 0.0;

      if (!insideBox || !hasBox) {
        gl_FragColor = baseColor;
        return;
      }

      float borderThickness = 0.005;
      bool onBorder = abs(uv.x - uBox.x) < borderThickness ||
                      abs(uv.x - uBox.z) < borderThickness ||
                      abs(uv.y - uBox.y) < borderThickness ||
                      abs(uv.y - uBox.w) < borderThickness;

      if (onBorder) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
      }

      vec2 noiseUV = uv + vec2(snoise(uv * 3.0 + uTime * 0.5), snoise(uv * 3.0 + uTime * 0.5 + 100.0)) * 0.05;
      vec4 displacedColor = texture2D(uTexture, noiseUV);

      float aberration = snoise(uv * 10.0 + uTime) * 0.01;
      vec4 rColor = texture2D(uTexture, uv + vec2(aberration, 0.0));
      vec4 gColor = texture2D(uTexture, uv);
      vec4 bColor = texture2D(uTexture, uv - vec2(aberration, 0.0));

      float pixelSize = 80.0;
      float aspect = uResolution.x / uResolution.y;
      vec2 pixelUV = floor(uv * vec2(pixelSize, pixelSize / aspect)) / vec2(pixelSize, pixelSize / aspect);
      vec4 pixelColor = texture2D(uTexture, pixelUV);

      vec2 texel = 1.0 / uResolution;
      vec4 n = texture2D(uTexture, uv + vec2(0.0, texel.y));
      vec4 s = texture2D(uTexture, uv - vec2(0.0, texel.y));
      vec4 e = texture2D(uTexture, uv + vec2(texel.x, 0.0));
      vec4 w = texture2D(uTexture, uv - vec2(texel.x, 0.0));
      vec4 ne = texture2D(uTexture, uv + vec2(texel.x, texel.y));
      vec4 nw = texture2D(uTexture, uv - vec2(texel.x, -texel.y));
      vec4 se = texture2D(uTexture, uv + vec2(-texel.x, texel.y));
      vec4 sw = texture2D(uTexture, uv - vec2(-texel.x, -texel.y));

      float lum = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
      float displacedLum = dot(displacedColor.rgb, vec3(0.299, 0.587, 0.114));
      float pixelLum = dot(pixelColor.rgb, vec3(0.299, 0.587, 0.114));

      vec3 finalColor;

      if (uEffect < 0.5) {
        float t = displacedLum;
        vec3 fireColor;
        if (t < 0.33) {
          fireColor = mix(vec3(0.1, 0.0, 0.0), vec3(1.0, 0.0, 0.0), t / 0.33);
        } else if (t < 0.66) {
          fireColor = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.33) / 0.33);
        } else {
          fireColor = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.66) / 0.34);
        }
        finalColor = fireColor;
      } else if (uEffect < 1.5) {
        float boostedLum = pow(lum, 1.2) * 1.5;
        float edgeNoise = snoise(uv * 200.0 + uTime * 0.5) * 0.15;
        float core = smoothstep(0.5 + edgeNoise, 0.7 + edgeNoise, boostedLum);
        float halo = smoothstep(0.2 + edgeNoise, 0.6 + edgeNoise, boostedLum);
        vec3 bgColor = vec3(0.0, 0.0, 0.0);
        vec3 haloColor = vec3(0.4, 0.9, 1.0);
        vec3 coreColor = vec3(1.0, 1.0, 1.0);
        vec3 withHalo = mix(bgColor, haloColor, halo);
        finalColor = mix(withHalo, coreColor, core);
      } else if (uEffect < 2.5) {
        float t = clamp((lum - 0.1) * 1.2, 0.0, 1.0);
        vec3 thermalColor;
        if (t < 0.25) {
          thermalColor = mix(vec3(0.0, 0.0, 0.2), vec3(0.1, 0.0, 1.0), t / 0.25);
        } else if (t < 0.5) {
          thermalColor = mix(vec3(0.1, 0.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.25) / 0.25);
        } else if (t < 0.75) {
          thermalColor = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.9, 0.0), (t - 0.5) / 0.25);
        } else {
          thermalColor = mix(vec3(1.0, 0.9, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.75) / 0.25);
        }
        finalColor = thermalColor;
      } else if (uEffect < 3.5) {
        vec2 cellCenter = floor(pixelUV * vec2(pixelSize, pixelSize / aspect)) / vec2(pixelSize, pixelSize / aspect) +
                          vec2(0.5 / pixelSize, 0.5 / (pixelSize / aspect));
        float dist = distance(uv, cellCenter);
        vec3 pixelFinal;
        if (dist < 0.35) {
          pixelFinal = vec3(0.0, pixelLum > 0.25 ? 1.0 : 0.0, 0.0);
        } else {
          pixelFinal = vec3(0.0, 0.1, 0.0);
        }
        finalColor = pixelFinal;
      } else if (uEffect < 4.5) {
        vec3 glitchColor = vec3(rColor.r, gColor.g, bColor.b);
        float scanlines = sin(uv.y * 800.0 + uTime * 10.0) * 0.05;
        glitchColor -= scanlines;
        finalColor = clamp(glitchColor, 0.0, 1.0);
      } else if (uEffect < 5.5) {
        float edge = length(n.rgb - s.rgb) + length(e.rgb - w.rgb) +
                     length(ne.rgb - sw.rgb) + length(nw.rgb - se.rgb);
        vec3 edgeColor = vec3(0.1, 1.0, 0.8) * edge * 2.5;
        finalColor = edgeColor + baseColor.rgb * 0.3;
      } else {
        finalColor = baseColor.rgb;
      }

      gl_FragColor = vec4(finalColor, 1.0);
    }
  `

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTexture: { value: null },
          uTime: { value: 0 },
          uBox: { value: new THREE.Vector4(0, 0, 0, 0) },
          uEffect: { value: 0 },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
        }}
      />
    </mesh>
  )
}
