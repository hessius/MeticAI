import { useState, useEffect, useRef, useCallback } from 'react'

interface UseReplayAnimationOptions {
  maxTime: number
}

interface UseReplayAnimationReturn {
  isPlaying: boolean
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>
  playbackSpeed: number
  setPlaybackSpeed: React.Dispatch<React.SetStateAction<number>>
  currentTime: number
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
  handlePlayPause: () => void
  handleRestart: () => void
}

export function useReplayAnimation({ maxTime }: UseReplayAnimationOptions): UseReplayAnimationReturn {
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const animationRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  // Animation loop
  useEffect(() => {
    if (!isPlaying || maxTime === 0) return

    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp
      }

      const deltaMs = timestamp - lastFrameTimeRef.current
      lastFrameTimeRef.current = timestamp
      const deltaSeconds = (deltaMs / 1000) * playbackSpeed

      setCurrentTime(prev => {
        const next = prev + deltaSeconds
        if (next >= maxTime) {
          setIsPlaying(false)
          return maxTime
        }
        return next
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      lastFrameTimeRef.current = 0
    }
  }, [isPlaying, playbackSpeed, maxTime])

  const handlePlayPause = useCallback(() => {
    if (currentTime >= maxTime) {
      setCurrentTime(0)
    }
    setIsPlaying(prev => !prev)
  }, [currentTime, maxTime])

  const handleRestart = useCallback(() => {
    setCurrentTime(0)
    setIsPlaying(false)
  }, [])

  return {
    isPlaying,
    setIsPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    currentTime,
    setCurrentTime,
    handlePlayPause,
    handleRestart,
  }
}
