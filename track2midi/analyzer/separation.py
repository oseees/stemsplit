"""Demucs stem separation wrapper.

Splits a track into drums / bass / other / vocals and writes them to disk.
Uses the in-process demucs.api when available, falling back to the CLI.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, Optional

Progress = Optional[Callable[[str, float], None]]

STEMS = ("drums", "bass", "other", "vocals")


def separate(input_path: str, out_dir: str, model: str = "htdemucs",
             device: Optional[str] = None,
             progress: Progress = None) -> Dict[str, str]:
    """Separate ``input_path`` into stems under ``out_dir/stems``.

    Returns a dict mapping stem name -> wav path.
    """
    stems_dir = Path(out_dir) / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)

    if progress:
        progress("Separating stems with Demucs (this is the slow step)…", 0.05)

    try:
        return _separate_api(input_path, stems_dir, model, device, progress)
    except Exception as e:  # noqa: BLE001 - fall back to CLI on any API issue
        if progress:
            progress(f"Demucs API unavailable ({e}); using CLI…", 0.05)
        return _separate_cli(input_path, stems_dir, model, device)


def _separate_api(input_path: str, stems_dir: Path, model: str,
                  device: Optional[str], progress: Progress) -> Dict[str, str]:
    from demucs.api import Separator, save_audio  # type: ignore

    kwargs = {"model": model}
    if device:
        kwargs["device"] = device
    separator = Separator(**kwargs)
    _, sources = separator.separate_audio_file(input_path)

    paths: Dict[str, str] = {}
    for name, source in sources.items():
        p = stems_dir / f"{name}.wav"
        save_audio(source, str(p), samplerate=separator.samplerate)
        paths[name] = str(p)
    if progress:
        progress("Stems ready.", 0.45)
    return paths


def _separate_cli(input_path: str, stems_dir: Path, model: str,
                  device: Optional[str]) -> Dict[str, str]:
    cmd = [sys.executable, "-m", "demucs", "-n", model,
           "-o", str(stems_dir), input_path]
    if device:
        cmd += ["-d", device]
    subprocess.run(cmd, check=True)
    # CLI writes to stems_dir/<model>/<trackname>/<stem>.wav
    track = Path(input_path).stem
    src = stems_dir / model / track
    paths: Dict[str, str] = {}
    for name in STEMS:
        p = src / f"{name}.wav"
        if p.exists():
            paths[name] = str(p)
    return paths
