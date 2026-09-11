export class AcousticReceiver {
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private isListening = false;

  private MARK_FREQ = 1200;
  private SPACE_FREQ = 2200;

  async startListening(baud: number, onMessage: (msg: string) => void, onError: (err: string) => void) {
    if (this.isListening) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      // 512 samples is ~12 ms at 44.1 kHz: enough frequency resolution for
      // 1200/2200 Hz FSK while leaving multiple observations per 10–40 baud bit.
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0;
      source.connect(this.analyser);
      this.isListening = true;

      const sampleRate = this.audioCtx.sampleRate;
      const dataArray = new Float32Array(this.analyser.frequencyBinCount);
      const markBin = Math.round((this.MARK_FREQ * this.analyser.fftSize) / sampleRate);
      const spaceBin = Math.round((this.SPACE_FREQ * this.analyser.fftSize) / sampleRate);

      let bitBuffer: number[] = [];
      let characterBytes: number[] = [];
      const sampleIntervalMs = 1000 / baud;

      const timer = setInterval(() => {
        if (!this.isListening || !this.analyser) {
          clearInterval(timer);
          return;
        }

        this.analyser.getFloatFrequencyData(dataArray);
        const markEnergy = dataArray[markBin];
        const spaceEnergy = dataArray[spaceBin];

        if (markEnergy > -75 || spaceEnergy > -75) {
          const bit = markEnergy > spaceEnergy ? 1 : 0;
          bitBuffer.push(bit);

          if (bitBuffer.length === 10) {
            if (bitBuffer[0] === 0 && bitBuffer[9] === 1) {
              let byteVal = 0;
              for (let i = 0; i < 8; i++) {
                byteVal |= (bitBuffer[i + 1] << i);
              }
              
              if (byteVal > 0 && byteVal < 128) {
                characterBytes.push(byteVal);
                if (byteVal === 10) {
                  const decoded = new TextDecoder().decode(new Uint8Array(characterBytes));
                  onMessage(decoded.trim());
                  characterBytes = [];
                }
              }
            }
            bitBuffer = [];
          }
        }
      }, sampleIntervalMs);

    } catch (err) {
      onError(`Microphone access error: ${err}`);
      this.stopListening();
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
