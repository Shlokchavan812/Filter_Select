import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import EffectsCanvas from './EffectsCanvas'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Hand connections for skeleton drawing
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
] as const

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)

  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  } catch (gpuError) {
    console.warn('GPU hand landmarker init failed, retrying on CPU.', gpuError)

    return HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HAND_MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    })
  }
}

function App() {
  const [videoReady, setVideoReady] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [effectIndex, setEffectIndex] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const boxRef = useRef<[number, number, number, number]>([0, 0, 0, 0])
  const lastClapTimeRef = useRef<number>(0)
  const animationFrameRef = useRef<number>()

  // Initialize webcam
  useEffect(() => {
    let isDisposed = false
    let stream: MediaStream | null = null

    const initWebcam = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        })

        if (!videoRef.current || isDisposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        videoRef.current.srcObject = stream
        videoRef.current.onloadeddata = async () => {
          try {
            await videoRef.current?.play()

            if (!isDisposed) {
              setVideoReady(true)
              setErrorMsg(null)
            }
          } catch (playError) {
            if (!isDisposed) {
              setErrorMsg('Camera started, but the browser blocked video playback.')
            }
            console.error('Video playback error:', playError)
          }
        }
      } catch (err) {
        if (!isDisposed) {
          setErrorMsg('Failed to access webcam. Please allow camera permissions.')
        }
        console.error('Webcam error:', err)
      }
    }

    initWebcam()

    return () => {
      isDisposed = true

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.srcObject = null
      }

      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Initialize MediaPipe
  useEffect(() => {
    if (!videoReady) return

    let isDisposed = false

    const initMediaPipe = async () => {
      try {
        const landmarker = await createHandLandmarker()

        if (isDisposed) {
          landmarker.close()
          return
        }

        landmarkerRef.current = landmarker
        setModelsReady(true)
        setErrorMsg(null)
      } catch (err) {
        if (!isDisposed) {
          setErrorMsg('Failed to load the hand detection model. Please refresh the page.')
        }
        console.error('MediaPipe error:', err)
      }
    }

    initMediaPipe()

    return () => {
      isDisposed = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [videoReady])

  // Tracking loop
  useEffect(() => {
    if (!videoReady || !modelsReady || !videoRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let isDisposed = false

    const track = () => {
      if (
        isDisposed ||
        !videoRef.current ||
        !landmarkerRef.current ||
        videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        animationFrameRef.current = requestAnimationFrame(track)
        return
      }

      try {
        const results = landmarkerRef.current.detectForVideo(
          videoRef.current,
          performance.now(),
        )

        drawTrackingOverlay(ctx, canvas, results.landmarks)
      } catch (err) {
        console.error('Hand tracking error:', err)
        setErrorMsg('Hand tracking stopped unexpectedly. Please reload the page.')
        return
      }

      animationFrameRef.current = requestAnimationFrame(track)
    }

    track()

    return () => {
      isDisposed = true

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [modelsReady, videoReady])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth
        canvasRef.current.height = window.innerHeight
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const drawTrackingOverlay = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    landmarks: NormalizedLandmark[][],
  ) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    landmarks.forEach((hand) => {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.lineWidth = 2

      HAND_CONNECTIONS.forEach(([start, end]) => {
        const startPoint = hand[start]
        const endPoint = hand[end]

        if (!startPoint || !endPoint) return

        ctx.beginPath()
        ctx.moveTo((1 - startPoint.x) * canvas.width, startPoint.y * canvas.height)
        ctx.lineTo((1 - endPoint.x) * canvas.width, endPoint.y * canvas.height)
        ctx.stroke()
      })

      ctx.fillStyle = '#ffffff'
      hand.forEach((landmark) => {
        ctx.beginPath()
        ctx.arc(
          (1 - landmark.x) * canvas.width,
          landmark.y * canvas.height,
          3,
          0,
          Math.PI * 2,
        )
        ctx.fill()
      })
    })

    updateEffectBox(landmarks)
  }

  const updateEffectBox = (landmarks: NormalizedLandmark[][]) => {
    if (landmarks.length !== 2) {
      boxRef.current = [0, 0, 0, 0]
      return
    }

    const hand1 = landmarks[0]
    const hand2 = landmarks[1]
    const p1 = hand1[9]
    const p2 = hand2[9]

    if (!p1 || !p2) {
      boxRef.current = [0, 0, 0, 0]
      return
    }

    const x1 = 1 - p1.x
    const y1 = p1.y
    const x2 = 1 - p2.x
    const y2 = p2.y
    const distance = Math.hypot(x2 - x1, y2 - y1)
    const now = performance.now()

    if (distance < 0.1) {
      boxRef.current = [0, 0, 0, 0]

      if (now - lastClapTimeRef.current > 1000) {
        setEffectIndex((prev) => (prev + 1) % 6)
        lastClapTimeRef.current = now
      }

      return
    }

    const boxWidth = distance * 1.2
    const boxHeight = boxWidth * 0.8
    const centerX = (x1 + x2) / 2
    const centerY = (y1 + y2) / 2

    boxRef.current = [
      Math.max(0, centerX - boxWidth / 2),
      Math.max(0, centerY - boxHeight / 2),
      Math.min(1, centerX + boxWidth / 2),
      Math.min(1, centerY + boxHeight / 2),
    ]
  }

  if (errorMsg) {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex flex-col items-center justify-center">
        <div className="text-red-500 text-6xl mb-4">Warning</div>
        <p className="text-red-400 text-lg mb-4">{errorMsg}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
        >
          Reload Page
        </button>
      </div>
    )
  }

  if (!videoReady) {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-zinc-700 border-t-white rounded-full animate-spin mb-4"></div>
        <p className="text-white text-lg">Waiting for Camera...</p>
      </div>
    )
  }

  if (!modelsReady) {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-zinc-700 border-t-white rounded-full animate-spin mb-4"></div>
        <p className="text-white text-lg">Loading AI Models...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-zinc-950 overflow-hidden relative">
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />

      <Canvas className="absolute inset-0">
        <EffectsCanvas
          video={videoRef.current}
          boxRef={boxRef}
          effectIndex={effectIndex}
        />
      </Canvas>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

export default App
