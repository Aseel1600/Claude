// Provider abstraction layer. Exposes OpenAI, Runway, ElevenLabs via unified API.
const openai = require("./openai");
const runway = require("./runway-mock");
const eleven = require("./elevenlabs-mock");

module.exports = {
  openai,
  runway,
  eleven
};
