"""Pluggable image-findings step of the hybrid pipeline.

Today this is Claude's vision model extracting *observations only* (not a
diagnosis). The `ImageClassifier` protocol is the seam: later, drop in a model
fine-tuned on a poultry-image dataset that returns the same `str` of findings,
and the reasoning step (diagnosis.py) is unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from . import config
from .llm import get_client


@dataclass
class ImageInput:
    data_b64: str
    media_type: str


_VISION_SYSTEM = (
    "You are a veterinary image-analysis assistant for poultry. Describe ONLY what is "
    "visually present in the image(s) that could be clinically relevant: posture, "
    "comb/wattle colour, eye/nostril discharge, droppings (colour, blood, consistency), "
    "feather condition, skin/leg lesions, swelling, and any post-mortem findings if shown. "
    "Be concise and factual. Do NOT name a disease, do NOT give a diagnosis, and do NOT "
    "recommend treatment — only report observations. If the image is unclear or not a bird, "
    "say so."
)


class ImageClassifier(Protocol):
    def analyze(self, images: list[ImageInput]) -> str: ...


class ClaudeVisionClassifier:
    """Image-findings via Claude's multimodal vision."""

    def analyze(self, images: list[ImageInput]) -> str:
        if not images:
            return ""
        client = get_client()
        content: list[dict] = []
        for img in images:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.media_type,
                        "data": img.data_b64,
                    },
                }
            )
        content.append(
            {"type": "text", "text": "List the clinically relevant observations from these images."}
        )
        resp = client.messages.create(
            model=config.MODEL,
            max_tokens=1024,
            system=_VISION_SYSTEM,
            messages=[{"role": "user", "content": content}],
        )
        return "".join(b.text for b in resp.content if b.type == "text").strip()


def default_classifier() -> ImageClassifier:
    return ClaudeVisionClassifier()
