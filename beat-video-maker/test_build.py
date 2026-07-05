# Self-check: synthetic 10s beat + 1 image + 1 short clip -> output lasts the beat's length.
import subprocess
import tempfile
from pathlib import Path

from app import build, duration


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
    print("ok:", out, out2)


if __name__ == "__main__":
    main()
