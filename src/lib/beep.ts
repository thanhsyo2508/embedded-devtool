// No bundled audio asset — a short oscillator beep needs no file and works
// the same across platforms without shipping/loading anything.
export function playBeep(): void {
  const ctx = new AudioContext()
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = 880
  gain.gain.setValueAtTime(0.2, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + 0.15)
  oscillator.onended = () => void ctx.close()
}
