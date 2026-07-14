#!/usr/bin/env python3
"""Track2MIDI — desktop app.

Drag a track onto the window; get stems + chords/bass/melody MIDI and the
detected BPM & key. Built on PySide6 with a background worker so the window
stays responsive during the (slow) Demucs separation.
"""
from __future__ import annotations

import os
import subprocess
import sys
import traceback
from pathlib import Path

from PySide6.QtCore import QMimeData, QObject, Qt, QThread, QUrl, Signal
from PySide6.QtGui import (QColor, QDrag, QFont, QFontMetrics, QPainter)
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QFileDialog,
                               QFrame, QHBoxLayout, QLabel, QProgressBar,
                               QPushButton, QVBoxLayout, QWidget)

from analyzer import analyze

OUTPUT_ROOT = Path.home() / "Track2MIDI"
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".aif", ".aiff"}

_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
KEY_CHOICES = ["From filename", "Auto-detect"] + \
    [f"{n} {m}" for n in _NOTES for m in ("major", "minor")]


def _key_from_filename(name: str):
    """Pull a key like 'A Min' / 'c-maj' / 'F#min' out of a filename."""
    import re
    m = re.search(r"\b([A-Ga-g])\s*(#|b|♯|♭)?[\s_-]*(maj|min|major|minor)\b",
                  name, re.IGNORECASE)
    return f"{m.group(1)}{m.group(2) or ''} {m.group(3)}" if m else None


class Worker(QObject):
    progress = Signal(str, float)
    finished = Signal(dict)
    failed = Signal(str)

    def __init__(self, input_path: str, output_dir: str, quantize: int,
                 key_override=None, separate=True, detail="balanced",
                 full_chords=False):
        super().__init__()
        self.input_path = input_path
        self.output_dir = output_dir
        self.quantize = quantize
        self.key_override = key_override
        self.separate = separate
        self.detail = detail
        self.full_chords = full_chords

    def run(self):
        try:
            res = analyze(
                self.input_path, self.output_dir, quantize_div=self.quantize,
                key_override=self.key_override, separate=self.separate,
                detail=self.detail, full_chords=self.full_chords,
                progress=lambda m, f: self.progress.emit(m, f))
            self.finished.emit(res.to_dict())
        except Exception:  # noqa: BLE001
            self.failed.emit(traceback.format_exc())


class DropZone(QFrame):
    fileDropped = Signal(str)

    def __init__(self):
        super().__init__()
        self.setObjectName("drop")
        self.setAcceptDrops(True)
        self.setMinimumHeight(150)
        lay = QVBoxLayout(self)
        lay.setAlignment(Qt.AlignCenter)
        self.label = QLabel("Drop an audio file here\nor click to browse")
        self.label.setAlignment(Qt.AlignCenter)
        self.label.setObjectName("dropLabel")
        lay.addWidget(self.label)

    def mousePressEvent(self, e):
        path, _ = QFileDialog.getOpenFileName(
            self, "Choose a track", str(Path.home()),
            "Audio (*.mp3 *.wav *.flac *.m4a *.aac *.ogg *.aif *.aiff)")
        if path:
            self.fileDropped.emit(path)

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()
            self.setProperty("hover", True)
            self._restyle()

    def dragLeaveEvent(self, e):
        self.setProperty("hover", False)
        self._restyle()

    def dropEvent(self, e):
        self.setProperty("hover", False)
        self._restyle()
        for url in e.mimeData().urls():
            p = url.toLocalFile()
            if Path(p).suffix.lower() in AUDIO_EXTS:
                self.fileDropped.emit(p)
                return

    def _restyle(self):
        self.style().unpolish(self)
        self.style().polish(self)


# A distinct hue per root pitch-class so the timeline reads at a glance.
_ROOT_HUES = [(108, 140, 255), (110, 195, 255), (80, 210, 200),
              (120, 220, 140), (190, 220, 110), (235, 210, 100),
              (245, 170, 90), (240, 130, 110), (235, 120, 170),
              (200, 130, 235), (150, 140, 240), (120, 165, 250)]


class ChordTimeline(QWidget):
    """Horizontal chord blocks: width ∝ duration, coloured by root."""

    def __init__(self):
        super().__init__()
        self.segments = []
        self.setMinimumHeight(72)
        self.setToolTip("Detected chord progression over time")

    def set_segments(self, segs):
        self.segments = list(segs or [])
        self.update()

    def paintEvent(self, _e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        p.fillRect(self.rect(), QColor("#1c1e25"))
        if not self.segments:
            p.setPen(QColor("#666"))
            p.drawText(self.rect(), Qt.AlignCenter, "—")
            return
        t0 = self.segments[0]["start"]
        t1 = self.segments[-1]["end"]
        span = max(t1 - t0, 1e-6)
        pad = 2
        usable = w - 2 * pad
        f = self.font()
        f.setPointSize(11)
        f.setBold(True)
        p.setFont(f)
        fm = QFontMetrics(f)
        for s in self.segments:
            x0 = pad + (s["start"] - t0) / span * usable
            x1 = pad + (s["end"] - t0) / span * usable
            bw = max(x1 - x0 - 3, 2)
            r, g, b = _ROOT_HUES[int(s.get("root", 0)) % 12]
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(r, g, b))
            p.drawRoundedRect(int(x0), pad, int(bw), h - 2 * pad, 5, 5)
            name = s.get("name", "")
            if name and fm.horizontalAdvance(name) <= bw - 4:
                p.setPen(QColor("#10131a"))
                p.drawText(int(x0), pad, int(bw), h - 2 * pad,
                           Qt.AlignCenter, name)


class DraggableMidi(QFrame):
    """A pill you can drag straight into FL Studio (click = reveal in Finder)."""

    LABELS = {"notes": "🎹  notes", "chords": "🎼  chords",
              "bass": "🎸  bass", "melody": "🎵  melody"}

    def __init__(self, kind: str, path: str):
        super().__init__()
        self.path = path
        self.setObjectName("chip")
        self.setCursor(Qt.OpenHandCursor)
        self.setToolTip(f"Drag into FL Studio  ·  {Path(path).name}\n"
                        "(or click to reveal in Finder)")
        lay = QHBoxLayout(self)
        lay.setContentsMargins(13, 7, 13, 7)
        lbl = QLabel(self.LABELS.get(kind, kind))
        lbl.setObjectName("chipLabel")
        lay.addWidget(lbl)
        self._press = None

    def mousePressEvent(self, e):
        self._press = e.position().toPoint()

    def mouseMoveEvent(self, e):
        if self._press is None:
            return
        if (e.position().toPoint() - self._press).manhattanLength() < 8:
            return
        drag = QDrag(self)
        mime = QMimeData()
        mime.setUrls([QUrl.fromLocalFile(self.path)])
        drag.setMimeData(mime)
        self.setCursor(Qt.ClosedHandCursor)
        drag.exec(Qt.CopyAction)
        self.setCursor(Qt.OpenHandCursor)
        self._press = None

    def mouseReleaseEvent(self, e):
        if self._press is not None and \
                (e.position().toPoint() - self._press).manhattanLength() < 8:
            if Path(self.path).exists():
                subprocess.run(["open", "-R", self.path])
        self._press = None


class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Track2MIDI")
        self.setMinimumWidth(560)
        self.thread = None
        self.worker = None
        self.input_path = None
        self.result = None

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(16)

        title = QLabel("Track2MIDI")
        title.setObjectName("title")
        sub = QLabel("Chords · Bass · Melody MIDI + BPM & Key for FL Studio")
        sub.setObjectName("subtitle")
        root.addWidget(title)
        root.addWidget(sub)

        self.drop = DropZone()
        self.drop.fileDropped.connect(self.set_file)
        root.addWidget(self.drop)

        # Options row
        opts = QHBoxLayout()
        opts.addWidget(QLabel("Quantize:"))
        self.grid_combo = QComboBox()
        self.grid_combo.addItems(["1/16 (tight)", "1/8", "1/4", "Off"])
        opts.addWidget(self.grid_combo)
        opts.addSpacing(16)
        opts.addWidget(QLabel("Key:"))
        self.key_combo = QComboBox()
        self.key_combo.addItems(KEY_CHOICES)
        self.key_combo.setToolTip("Lock the key for accurate chords. "
                                  "'Auto' detects it; 'From filename' reads it "
                                  "from the file name if present.")
        opts.addWidget(self.key_combo)
        opts.addStretch()
        root.addLayout(opts)

        # Second options row
        opts2 = QHBoxLayout()
        opts2.addWidget(QLabel("Detail:"))
        self.detail_combo = QComboBox()
        self.detail_combo.addItems(["Balanced", "Detailed (more notes)",
                                    "Clean (fewer notes)"])
        self.detail_combo.setToolTip(
            "How many notes to transcribe. Detailed = closest to the sample "
            "but busier; Clean = fewer, easier-to-edit notes; Balanced = both.")
        opts2.addWidget(self.detail_combo)
        opts2.addSpacing(16)
        self.sample_check = QCheckBox("Single instrument (skip separation)")
        self.sample_check.setToolTip("For a loop or single-instrument sample: "
                                     "skips Demucs, much faster.")
        opts2.addWidget(self.sample_check)
        opts2.addStretch()
        root.addLayout(opts2)

        # Third options row
        opts3 = QHBoxLayout()
        self.full_check = QCheckBox("Full chords (legato)")
        self.full_check.setToolTip("Stretch every chord note to last its whole "
                                   "chord — guaranteed-full, no patchy gaps. "
                                   "Best with Quantize on.")
        opts3.addWidget(self.full_check)
        opts3.addStretch()
        root.addLayout(opts3)

        self.analyze_btn = QPushButton("Analyze")
        self.analyze_btn.setObjectName("primary")
        self.analyze_btn.setEnabled(False)
        self.analyze_btn.clicked.connect(self.start)
        root.addWidget(self.analyze_btn)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.bar.setValue(0)
        self.bar.hide()
        root.addWidget(self.bar)

        self.status = QLabel("")
        self.status.setObjectName("status")
        root.addWidget(self.status)

        self.results = QLabel("")
        self.results.setObjectName("results")
        self.results.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.results.hide()
        root.addWidget(self.results)

        # Visual chord progression
        self.timeline_label = QLabel("Chord progression")
        self.timeline_label.setObjectName("sectionLabel")
        self.timeline_label.hide()
        root.addWidget(self.timeline_label)
        self.timeline = ChordTimeline()
        self.timeline.hide()
        root.addWidget(self.timeline)

        # Drag-out MIDI chips
        self.drag_hint = QLabel("Drag into FL Studio  →")
        self.drag_hint.setObjectName("sectionLabel")
        self.drag_hint.hide()
        root.addWidget(self.drag_hint)
        self.midi_row = QHBoxLayout()
        self.midi_row.setSpacing(8)
        self.midi_row.setContentsMargins(0, 0, 0, 0)
        self.midi_row_widget = QWidget()
        self.midi_row_widget.setLayout(self.midi_row)
        self.midi_row_widget.hide()
        root.addWidget(self.midi_row_widget)

        self.open_btn = QPushButton("Open output folder")
        self.open_btn.clicked.connect(self.open_output)
        self.open_btn.hide()
        root.addWidget(self.open_btn)

        self.setStyleSheet(STYLE)

    # ------------------------------------------------------------------
    def set_file(self, path: str):
        self.input_path = path
        self.drop.label.setText(f"🎵  {Path(path).name}\n(click to choose another)")
        self.analyze_btn.setEnabled(True)
        self._hide_outputs()
        self.status.setText("")

    def _hide_outputs(self):
        for w in (self.results, self.open_btn, self.timeline_label,
                  self.timeline, self.drag_hint, self.midi_row_widget):
            w.hide()

    def _clear_midi_row(self):
        while self.midi_row.count():
            item = self.midi_row.takeAt(0)
            wgt = item.widget()
            if wgt is not None:
                wgt.deleteLater()

    def _quantize_div(self) -> int:
        return {0: 4, 1: 2, 2: 1, 3: 0}[self.grid_combo.currentIndex()]

    def _key_override(self):
        choice = self.key_combo.currentText()
        if choice == "Auto-detect":
            return None
        if choice == "From filename":
            return _key_from_filename(Path(self.input_path).name) if self.input_path else None
        return choice  # an explicit key like "A minor"

    def start(self):
        if not self.input_path:
            return
        out = OUTPUT_ROOT / Path(self.input_path).stem
        out.mkdir(parents=True, exist_ok=True)
        self.result = {"output_dir": str(out)}

        self.analyze_btn.setEnabled(False)
        self.drop.setEnabled(False)
        self.bar.show()
        self.bar.setValue(0)
        self._hide_outputs()

        div = self._quantize_div() or 4
        key_override = self._key_override()
        separate = not self.sample_check.isChecked()
        detail = {"Balanced": "balanced",
                  "Detailed (more notes)": "detailed",
                  "Clean (fewer notes)": "clean"}.get(
                      self.detail_combo.currentText(), "balanced")
        full_chords = self.full_check.isChecked()
        self.thread = QThread()
        self.worker = Worker(self.input_path, str(out), div, key_override,
                             separate, detail, full_chords)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.progress.connect(self.on_progress)
        self.worker.finished.connect(self.on_finished)
        self.worker.failed.connect(self.on_failed)
        self.thread.start()

    def on_progress(self, msg: str, frac: float):
        self.bar.setValue(int(frac * 100))
        self.status.setText(msg)

    def on_finished(self, res: dict):
        self.result = res
        self._cleanup_thread()
        self.bar.setValue(100)
        self.status.setText("Done ✓")
        self.results.setText(
            f"<b>Tempo:</b> {res['bpm']} BPM &nbsp;·&nbsp; "
            f"<b>Key:</b> {res['key']} "
            f"<span style='color:#888'>(conf {res['key_confidence']})</span><br>"
            f"<span style='color:#888'>Set the FL project tempo to "
            f"{res['bpm']}, then drag the chips below straight into FL.</span>")
        self.results.show()

        # Visual chord progression
        segs = res.get("chord_segments", [])
        self.timeline.set_segments(segs)
        self.timeline_label.setVisible(bool(segs))
        self.timeline.setVisible(bool(segs))

        # Drag-out MIDI chips (notes / chords / bass / melody)
        self._clear_midi_row()
        midi_files = res.get("midi_files", {})
        order = ["notes", "chords", "bass", "melody"]
        kinds = [k for k in order if k in midi_files] + \
                [k for k in midi_files if k not in order]
        for k in kinds:
            self.midi_row.addWidget(DraggableMidi(k, midi_files[k]))
        self.midi_row.addStretch()
        self.drag_hint.setVisible(bool(midi_files))
        self.midi_row_widget.setVisible(bool(midi_files))

        self.open_btn.show()
        self.analyze_btn.setEnabled(True)
        self.drop.setEnabled(True)

    def on_failed(self, tb: str):
        self._cleanup_thread()
        self.status.setText("Failed — see details below.")
        self.results.setText(f"<span style='color:#e66'>{tb.splitlines()[-1]}</span>")
        self.results.show()
        self.analyze_btn.setEnabled(True)
        self.drop.setEnabled(True)
        print(tb, file=sys.stderr)

    def _cleanup_thread(self):
        if self.thread:
            self.thread.quit()
            self.thread.wait()
            self.thread = None
            self.worker = None

    def open_output(self):
        out = (self.result or {}).get("output_dir")
        if out and Path(out).exists():
            subprocess.run(["open", out])


STYLE = """
QWidget { background: #16171c; color: #e8e8ea; font-family: -apple-system, 'SF Pro Text'; font-size: 13px; }
#title { font-size: 26px; font-weight: 700; color: #fff; }
#subtitle { color: #9aa0aa; font-size: 13px; margin-bottom: 4px; }
#drop { border: 2px dashed #3a3d47; border-radius: 12px; background: #1c1e25; }
#drop[hover="true"] { border-color: #6c8cff; background: #20242f; }
#dropLabel { color: #9aa0aa; font-size: 15px; }
#primary { background: #6c8cff; color: #fff; border: none; border-radius: 9px; padding: 11px; font-size: 14px; font-weight: 600; }
#primary:disabled { background: #353846; color: #888; }
#primary:hover:enabled { background: #5a7bff; }
QPushButton { background: #2a2d38; color: #e8e8ea; border: none; border-radius: 8px; padding: 9px; }
QPushButton:hover { background: #343845; }
QComboBox { background: #2a2d38; border: 1px solid #3a3d47; border-radius: 6px; padding: 5px 8px; }
QProgressBar { background: #2a2d38; border: none; border-radius: 6px; height: 8px; text-align: center; }
QProgressBar::chunk { background: #6c8cff; border-radius: 6px; }
#status { color: #9aa0aa; }
#results { background: #1c1e25; border: 1px solid #2a2d38; border-radius: 10px; padding: 14px; line-height: 1.6; }
#sectionLabel { color: #9aa0aa; font-size: 12px; font-weight: 600; margin-top: 6px; }
ChordTimeline { border: 1px solid #2a2d38; border-radius: 8px; }
#chip { background: #2a2d38; border: 1px solid #3a3d47; border-radius: 16px; }
#chip:hover { background: #343a4a; border-color: #6c8cff; }
#chipLabel { color: #e8e8ea; font-size: 13px; font-weight: 600; }
"""


def main():
    app = QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
