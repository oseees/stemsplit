# Self-check: synthetic 10s beat + 1 image + 1 short clip -> output lasts the beat's length.
import subprocess
import tempfile
from pathlib import Path

from app import FORMATS, MAX_CLIP_SECONDS, auto_clips, build, duration


def main():
    work = Path(tempfile.mkdtemp(prefix="beatvideo_test_"))
    beat = work / "beat.mp3"
    img = work / "pic.png"
    clip = work / "clip.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=10",
                    str(beat)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x480:d=1",
                    "-frames:v", "1", str(img)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=880:duration=3",  # clip audio must get dropped
                    "-shortest", str(clip)], check=True, capture_output=True)

    out = work / "out.mp4"
    build(beat, [img, clip], out)

    assert abs(duration(out) - 10.0) < 0.5, f"bad duration: {duration(out)}"
    streams = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
         "-of", "csv=p=0", str(out)], capture_output=True, text=True, check=True).stdout.split()
    assert sorted(streams) == ["audio", "video"], streams

    # clip-selection path: cut two sub-clips from the "music video", apply a filter
    out2 = work / "out2.mp4"
    build(beat, [], out2, vf_extra="hue=s=0", source=clip,
          clips=[(0.0, 1.0), (1.5, 2.5)])
    assert abs(duration(out2) - 10.0) < 0.5, f"bad clip duration: {duration(out2)}"

    # auto clip picking: scene-cut video (red 3s | blue 3s | green 3s) and a no-cuts fallback
    scenes = work / "scenes.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                    "color=red:s=320x240:d=3,format=yuv420p", "-f", "lavfi", "-i",
                    "color=blue:s=320x240:d=3,format=yuv420p", "-f", "lavfi", "-i",
                    "color=green:s=320x240:d=3,format=yuv420p",
                    "-filter_complex", "concat=n=3", str(scenes)],
                   check=True, capture_output=True)
    for src in (scenes, clip):  # clip = testsrc, no scene changes -> fallback path
        picked = auto_clips(src, 30.0)
        assert len(picked) >= 3, picked
        src_dur = duration(src)
        for s, e in picked:
            assert 0 <= s < e <= src_dur + 0.1 and e - s <= MAX_CLIP_SECONDS, (src, s, e)

    # each format renders at its declared frame size (vertical/square fill, no bars)
    for fmt, (ew, eh, _) in FORMATS.items():
        o = work / f"{fmt}.mp4"
        build(beat, [img], o, fmt=fmt)
        dims = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(o)],
            capture_output=True, text=True, check=True).stdout.strip()
        assert dims == f"{ew}x{eh}", (fmt, dims)

    # intro/outro skip: on a 30s video, no clip should start in the first 5s or last 10s
    long_src = work / "long.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:d=30",
                    str(long_src)], check=True, capture_output=True)
    for s, e in auto_clips(long_src, 40.0, head_skip=5.0, tail_skip=10.0):
        assert s >= 5.0 - 0.01 and e <= 30.0 - 10.0 + 0.01, (s, e)
    print("ok:", out, out2)


if __name__ == "__main__":
    main()
