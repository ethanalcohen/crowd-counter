import type { FrameAnalysis, StreamMessage, VideoInfo } from '../types'

class StreamStore {
  videoId = $state<string | null>(null)
  info = $state<VideoInfo | null>(null)
  frame = $state<FrameAnalysis | null>(null)
  playing = $state(true)
  fps = $state(2)
  fpsActual = $state(0)
  error = $state<string | null>(null)
  connected = $state(false)

  private ws: WebSocket | null = null
  private lastFrameTime = 0
  private fpsBuffer: number[] = []

  connect(videoId: string) {
    this.disconnect()
    this.videoId = videoId
    this.info = null
    this.frame = null
    this.error = null
    this.fpsBuffer = []
    this.lastFrameTime = 0

    const wsUrl = `ws://${window.location.hostname}:17893/api/video/${videoId}/stream`
    const ws = new WebSocket(wsUrl)
    this.ws = ws

    ws.onopen = () => {
      this.connected = true
      this.send({ action: 'fps', fps: this.fps })
      this.send({ action: this.playing ? 'play' : 'pause' })
    }

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as StreamMessage
      if (msg.type === 'info') {
        this.info = msg.info
      } else if (msg.type === 'frame') {
        this.frame = msg
        const now = performance.now()
        if (this.lastFrameTime > 0) {
          const dt = (now - this.lastFrameTime) / 1000
          this.fpsBuffer.push(1 / dt)
          if (this.fpsBuffer.length > 10) this.fpsBuffer.shift()
          this.fpsActual = this.fpsBuffer.reduce((a, b) => a + b, 0) / this.fpsBuffer.length
        }
        this.lastFrameTime = now
      } else if ('error' in msg) {
        this.error = msg.error
      }
    }

    ws.onerror = () => {
      this.error = 'connection error'
      this.connected = false
    }

    ws.onclose = () => {
      this.connected = false
    }
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
    this.connected = false
  }

  togglePlay() {
    this.playing = !this.playing
    this.send({ action: this.playing ? 'play' : 'pause' })
  }

  seek(frameIdx: number) {
    this.send({ action: 'seek', frame: frameIdx })
  }

  setFps(fps: number) {
    this.fps = fps
    this.send({ action: 'fps', fps })
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}

export const stream = new StreamStore()
