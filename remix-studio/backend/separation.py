"""Source separation with Demucs htdemucs (4 stems). Heavy imports are lazy so the
rest of the backend (and its tests) works without torch or a GPU."""
from __future__ import annotations

import numpy as np

STEMS = ("vocals", "drums", "bass", "other")


class Separator:
    def __init__(self, model_name: str = "htdemucs", device: str | None = None, model=None):
        import torch

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        if model is None:
            from demucs.pretrained import get_model
            model = get_model(model_name)
        self.model = model.to(self.device).eval()
        self.samplerate = int(getattr(self.model, "samplerate", 44100))

    def separate(self, audio: np.ndarray, progress=None) -> dict[str, np.ndarray]:
        """audio: float32 (2, N) at self.samplerate -> {stem: (2, N)}."""
        from demucs.apply import apply_model

        torch = self.torch
        wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        with torch.inference_mode():
            out = apply_model(
                self.model, ((wav - mean) / std)[None].to(self.device),
                device=self.device, shifts=1, split=True, overlap=0.25, progress=False,
            )[0]
        out = (out * std.to(out.device) + mean.to(out.device)).float().cpu().numpy()
        stems = {name: out[i] for i, name in enumerate(self.model.sources)}
        return {k: stems[k].astype(np.float32) for k in STEMS}
