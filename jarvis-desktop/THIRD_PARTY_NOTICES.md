# Third-party notices — JARVIS Desktop

JARVIS Desktop uses the following third-party components. Their licences apply to those components only.

## Wake-word models (downloaded at build time, verified by SHA-256)

### openWakeWord pre-trained models — "hey_jarvis_v0.1", melspectrogram, embedding_model
- Source: https://github.com/dscripka/openWakeWord (release v0.5.1)
- Author: David Scripka
- **Licence: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**
  — https://creativecommons.org/licenses/by-nc-sa/4.0/
- The upstream README states that the code is Apache-2.0 and that all pre-trained models are CC BY-NC-SA 4.0. That is because the training data has unknown or restrictive licensing.
- JARVIS uses these models for **personal, non-commercial use only**. Any commercial distribution of JARVIS would need a different wake-word model.
- The inference pipeline in `src/wakeword/openwakeword.ts` is an independent TypeScript port of the Apache-2.0 openWakeWord code (`openwakeword/utils.py` and `openwakeword/model.py`).

### Picovoice Porcupine — `@picovoice/porcupine-node` 4.0.2 and `porcupine_params.pv`
- Source: https://github.com/Picovoice/porcupine — Apache License 2.0
- Using Porcupine requires a Picovoice **AccessKey**, which is subject to Picovoice's own terms: https://picovoice.ai/pricing , https://picovoice.ai/docs/terms-of-use/
- Porcupine validates the AccessKey online. Audio is processed on the device.

## Runtime libraries (bundled)

| Component | Licence |
|---|---|
| Electron | MIT |
| React, React DOM | MIT |
| zod | MIT |
| luxon | MIT |
| @anthropic-ai/sdk | MIT |
| onnxruntime-web (Microsoft) | MIT |
| Heebo font (@fontsource-variable/heebo) | SIL Open Font License 1.1 |
| Orbitron font (@fontsource/orbitron) | SIL Open Font License 1.1 |

## Cloud services (used only when you configure them)

- **Anthropic Claude API:** subject to Anthropic's Commercial Terms and Usage Policies.
- **OpenAI API** (transcription and/or speech): subject to the OpenAI Terms of Use.
- **Microsoft Azure AI Speech:** subject to the Microsoft Product Terms.
