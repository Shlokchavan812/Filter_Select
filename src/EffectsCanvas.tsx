import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface EffectsCanvasProps {
  video: HTMLVideoElement | null
  boxRef: React.MutableRefObject<[number, number, number, number]>
  effectIndex: number
}

// Create a default white texture
const createDefaultTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 1280, 720)
  }
  return new THREE.CanvasTexture(canvas)
}

export default function EffectsCanvas({ video, boxRef, effectIndex }: EffectsCanvasProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const textureRef = useRef<THREE.Texture>(createDefaultTexture())
  const meshRef = useRef<THREE.Mesh>(null)
  const { size, camera } = useThree()

  useEffect(() => {
    if (!materialRef.current) return

    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Use white texture if no video
      return
    }

    const updateTexture = () => {
      if (!materialRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return

      // Dispose old texture if it was a video texture
      if (textureRef.current instanceof THREE.VideoTexture) {
        textureRef.current.dispose()
      }

      const texture = new THREE.VideoTexture(video)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter

      textureRef.current = texture
      if (materialRef.current) {
        materialRef.current.uniforms.uTexture.value = texture
      }
    }

    // Try to update immediately
    updateTexture()
    
    // Also try when video data loads
    if (video) {
      video.addEventListener('loadeddata', updateTexture)
      video.addEventListener('play', updateTexture)
    }

    return () => {
      if (video) {
        video.removeEventListener('loadeddata', updateTexture)
        video.removeEventListener('play', updateTexture)
      }
    }
  }, [video])

  // Initialize camera position
  useEffect(() => {
    camera.position.z = 1
  }, [camera])

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
    uniform float uTime;
    uniform vec4 uBox;
    uniform float uEffect;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      
      // Show animated colors
      vec3 color = vec3(
        sin(uTime + uv.x * 3.0) * 0.5 + 0.5,
        cos(uTime + uv.y * 3.0) * 0.5 + 0.5,
        sin(uTime * 0.5 + (uv.x + uv.y) * 2.0) * 0.5 + 0.5
      );
      
      // Highlight box area if present
      bool insideBox = uv.x >= uBox.x && uv.x <= uBox.z && uv.y >= uBox.y && uv.y <= uBox.w;
      bool hasBox = uBox.z > 0.0;
      
      if (hasBox && insideBox) {
        float borderThickness = 0.01;
        bool onBorder = abs(uv.x - uBox.x) < borderThickness ||
                        abs(uv.x - uBox.z) < borderThickness ||
                        abs(uv.y - uBox.y) < borderThickness ||
                        abs(uv.y - uBox.w) < borderThickness;
        
        if (onBorder) {
          color = vec3(1.0, 1.0, 1.0);
        } else {
          color = color * vec3(1.5, 1.0, 0.5);
        }
      }
      
      gl_FragColor = vec4(color, 1.0);
    }
  `

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTexture: { value: textureRef.current },
          uTime: { value: 0 },
          uBox: { value: new THREE.Vector4(0, 0, 0, 0) },
          uEffect: { value: 0 },
          uResolution: { value: new THREE.Vector2(size.width, size.height) },
        }}
      />
    </mesh>
  )
}
