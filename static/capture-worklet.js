// v4.0 — captura do trecho para o Shazam fora da thread principal.
// Manda cada bloco de amostras (mono) para a página; a saída fica em silêncio.
class ClipCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor("clip-capture", ClipCaptureProcessor);
