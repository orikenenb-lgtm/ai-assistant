// AudioWorklet: מעביר בלוקים של אודיו (ערוץ ראשון) ל-thread הראשי. רץ ב-AudioContext של 16kHz.
// אין כאן עיבוד או שליחה לרשת — רק העתקה של הדגימות.
class Capture16k extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('jarvis-capture-16k', Capture16k);
