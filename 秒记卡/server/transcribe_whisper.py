import hashlib
import json
import os
import pathlib
import sys
import urllib.request


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def download(url):
    media_dir = pathlib.Path(os.environ.get("WHISPER_MEDIA_DIR", "work/asr-media"))
    media_dir.mkdir(parents=True, exist_ok=True)
    suffix = pathlib.Path(url.split("?", 1)[0]).suffix or ".mp4"
    target = media_dir / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:24]}{suffix}"
    if target.exists() and target.stat().st_size > 0:
        return target

    request = urllib.request.Request(url, headers={"User-Agent": "SecondNote/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        temp = target.with_suffix(f"{target.suffix}.part")
        with temp.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temp.replace(target)
    return target


def main():
    if len(sys.argv) != 2:
        fail("usage: transcribe_whisper.py <media-url>")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail("faster-whisper is not installed")

    media_path = download(sys.argv[1])
    model_name = os.environ.get("WHISPER_MODEL", "small")
    download_root = os.environ.get("WHISPER_DOWNLOAD_ROOT", "work/whisper-models")
    model = WhisperModel(
        model_name,
        device=os.environ.get("WHISPER_DEVICE", "cpu"),
        compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8"),
        download_root=download_root,
    )
    segments, info = model.transcribe(
        str(media_path),
        language=os.environ.get("WHISPER_LANGUAGE", "zh"),
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )

    payload = {
        "model": f"faster-whisper:{model_name}",
        "language": info.language,
        "duration": info.duration,
        "segments": [
            {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
            for segment in segments
            if segment.text.strip()
        ],
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
