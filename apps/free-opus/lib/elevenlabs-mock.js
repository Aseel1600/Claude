// Minimal ElevenLabs TTS mock
async function synthesize(text, opts = {}) {
  const voice = opts.voice || "alloy";
  // Return a mocked audio URL or buffer descriptor
  return { url: `https://mock-storage.local/tts/${encodeURIComponent(voice)}-${Date.now()}.mp3`, size: 12345 };
}

module.exports = { synthesize };
