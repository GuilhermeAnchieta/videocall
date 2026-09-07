export {};

declare global {
  interface HTMLVideoElement {
    captureStream(frameRate?: number): MediaStream;
    mozCaptureStream?(frameRate?: number): MediaStream;
  }
}
