// LAME stays in this worker so encoding a long recording keeps the controls responsive.
importScripts('./vendor/lame.min.js');
let encoder;
self.onmessage = ({data}) => {
  try {
    encoder ??= new lamejs.Mp3Encoder(1, 24000, 96);
    if (data === 'finish') {
      const tail = Uint8Array.from(encoder.flush());
      encoder = null;
      self.postMessage(tail.buffer, [tail.buffer]);
      return;
    }
    const samples = new Int16Array(data);
    const frames = [];
    for (let i = 0; i < samples.length; i += 1152) {
      const bytes = encoder.encodeBuffer(samples.subarray(i, i + 1152));
      if (bytes.length) frames.push(bytes);
    }
    self.postMessage(new Blob(frames, {type:'audio/mpeg'}));
  } catch (error) {
    self.postMessage({error: String(error.message || error)});
  }
};
