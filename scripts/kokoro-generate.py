"""Generate English speech with Kokoro and write word timestamps."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KOKORO_ROOT = Path(os.environ.get("KOKORO_ROOT") or "D:/localfactory-data/tools/kokoro")
PORTABLE = KOKORO_ROOT / "espeak-admin" / "eSpeak NG"
DATA = PORTABLE / "espeak-ng-data"
for candidate in (
    PORTABLE / "libespeak-ng.dll",
    PORTABLE / "espeak-ng.exe",
    KOKORO_ROOT / "espeak-bin" / "SourceDir" / "libespeak-ng.dll",
):
    if candidate.exists():
        os.environ["PATH"] = str(candidate.parent) + os.pathsep + os.environ.get("PATH", "")
        if candidate.suffix.lower() == ".dll":
            os.environ.setdefault("PHONEMIZER_ESPEAK_LIBRARY", str(candidate))
        break
if DATA.exists():
    os.environ.setdefault("ESPEAK_DATA_PATH", str(DATA))


def _bind_espeakng_loader() -> None:
    try:
        import espeakng_loader
    except ImportError:
        return
    lib = Path(getattr(espeakng_loader, "get_library_path", lambda: "")() or "")
    data = Path(getattr(espeakng_loader, "get_data_path", lambda: "")() or "")
    if lib.exists():
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = str(lib)
        os.environ["PATH"] = str(lib.parent) + os.pathsep + os.environ.get("PATH", "")
    if DATA.exists():
        os.environ["ESPEAK_DATA_PATH"] = str(DATA)
    elif data.exists():
        os.environ["ESPEAK_DATA_PATH"] = str(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate English speech with local Kokoro.")
    parser.add_argument("--text", default="")
    parser.add_argument("--text-file", default="")
    parser.add_argument("--voice", default="am_michael")
    parser.add_argument("--out", required=True)
    parser.add_argument("--meta", default="")
    parser.add_argument("--lang", default="a")
    parser.add_argument("--speed", type=float, default=1.0)
    args = parser.parse_args()
    if args.text_file:
        args.text = Path(args.text_file).read_text(encoding="utf-8")
    args.text = str(args.text or "").strip()
    if not args.text:
        raise SystemExit("请提供 --text 或 --text-file。")
    _bind_espeakng_loader()

    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pipeline = KPipeline(lang_code=args.lang)
    chunks = []
    words = []
    offset = 0.0
    for result in pipeline(args.text, voice=args.voice, speed=args.speed):
        audio = np.asarray(getattr(result, "audio", result[2] if isinstance(result, tuple) else None))
        tokens = getattr(result, "tokens", None) or []
        for token in tokens:
            text = str(getattr(token, "text", "") or "").strip()
            start = getattr(token, "start_ts", None)
            end = getattr(token, "end_ts", None)
            if not text or start is None:
                continue
            words.append({
                "text": text,
                "start": round(offset + float(start), 3),
                "end": round(offset + float(end if end is not None else start), 3)
            })
        chunks.append(audio)
        offset += len(audio) / 24000
    if not chunks:
        raise SystemExit("Kokoro 没有返回音频。")
    wav = np.concatenate(chunks)
    sf.write(out_path, wav, 24000)
    seconds = len(wav) / 24000
    meta = {
        "voice": args.voice,
        "duration": round(seconds, 3),
        "samples": int(len(wav)),
        "text": args.text,
        "words": words
    }
    if args.meta:
        meta_path = Path(args.meta)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    print(f"OK {out_path} {seconds:.2f}s voice={args.voice} words={len(words)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
