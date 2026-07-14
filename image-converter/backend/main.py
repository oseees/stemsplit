"""
Image Converter & Filter API
Converts images to JPG and applies various filters.
Serves the frontend UI at the root URL.
"""

import os
import uuid
import io
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageFilter, ImageEnhance, ImageOps

app = FastAPI(title="ImageForge – Image Converter & Filter", version="1.0.0")

# CORS — allow frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Path to the frontend directory (sibling to backend/)
FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()

# Supported input formats that Pillow can read
SUPPORTED_INPUT = {
    "png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif",
    "gif", "ico", "ppm", "pgm", "pbm", "pcx", "tga",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unique_name(extension: str = "jpg") -> str:
    return f"{uuid.uuid4().hex}.{extension}"


def _save_and_return(img: Image.Image, filename: str) -> FileResponse:
    """Save a PIL image to disk and return it as a downloadable FileResponse."""
    path = UPLOAD_DIR / filename
    if img.mode in ("RGBA", "P", "LA"):
        # Convert to RGB for JPG (no alpha channel)
        img = img.convert("RGB")
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.save(path, format="JPEG", quality=92, optimize=True)
    return FileResponse(
        path=path,
        media_type="image/jpeg",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# 1. Format Conversion  →  JPG
# ---------------------------------------------------------------------------

@app.post("/api/convert")
async def convert_to_jpg(file: UploadFile = File(...)):
    """Convert any supported image format to high-quality JPG."""
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else ""

    if ext not in SUPPORTED_INPUT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '.{ext}'. Supported: {', '.join(sorted(SUPPORTED_INPUT))}",
        )

    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read image: {e}")

    out_name = _unique_name("jpg")
    return _save_and_return(img, out_name)


# ---------------------------------------------------------------------------
# 2. Filters
# ---------------------------------------------------------------------------

@app.post("/api/filter")
async def apply_filter(
    file: UploadFile = File(...),
    filter_type: str = Form(...),
    intensity: float = Form(1.0),
):
    """
    Apply a filter to an uploaded image.

    Supported filter_type values:
      - grayscale
      - sepia
      - blur
      - sharpen
      - edge_enhance
      - emboss
      - contour
      - smooth
      - invert
      - brightness   (intensity: 0.0 – 3.0, default 1.0)
      - contrast     (intensity: 0.0 – 3.0, default 1.0)
      - saturation   (intensity: 0.0 – 3.0, default 1.0)
      - warmth       (intensity: -1.0 – 1.0, default 0.0)
      - vignette     (intensity: 0.0 – 1.0, default 0.5)
      - rotate       (intensity: degrees, e.g. 90, 180, -90)
    """
    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read image: {e}")

    original_mode = img.mode
    has_alpha = img.mode in ("RGBA", "LA", "PA")

    # ---- Dispatch ----
    ft = filter_type.lower().strip()

    if ft == "grayscale":
        img = ImageOps.grayscale(img)
        if has_alpha:
            img = img.convert("RGBA")

    elif ft == "sepia":
        gray = ImageOps.grayscale(img)
        # Sepia tone matrix
        sepia_data = []
        for px in gray.getdata():
            r = min(255, int(px * 1.2))
            g = min(255, int(px * 0.95))
            b = min(255, int(px * 0.7))
            sepia_data.append((r, g, b))
        img = Image.new("RGB", gray.size)
        img.putdata(sepia_data)

    elif ft == "blur":
        radius = max(0.5, intensity * 5)
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))

    elif ft == "sharpen":
        for _ in range(max(1, int(intensity))):
            img = img.filter(ImageFilter.SHARPEN)

    elif ft == "edge_enhance":
        img = img.filter(ImageFilter.EDGE_ENHANCE)

    elif ft == "emboss":
        img = img.filter(ImageFilter.EMBOSS)

    elif ft == "contour":
        img = img.filter(ImageFilter.CONTOUR)

    elif ft == "smooth":
        img = img.filter(ImageFilter.SMOOTH)

    elif ft == "invert":
        if img.mode in ("RGBA", "LA"):
            r, g, b, a = img.split()
            r = ImageOps.invert(r)
            g = ImageOps.invert(g)
            b = ImageOps.invert(b)
            img = Image.merge("RGBA", (r, g, b, a))
        else:
            img = ImageOps.invert(img.convert("RGB"))

    elif ft == "brightness":
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(max(0.0, intensity))

    elif ft == "contrast":
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(max(0.0, intensity))

    elif ft == "saturation":
        # Pillow's Color enhancer acts on saturation
        enhancer = ImageEnhance.Color(img)
        img = enhancer.enhance(max(0.0, intensity))

    elif ft == "warmth":
        # warmth: -1 (cool/blue) to +1 (warm/yellow)
        factor = max(-1.0, min(1.0, intensity))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if has_alpha else "RGB")
        bands = list(img.split())
        # Increase red, decrease blue for warmth; opposite for cool
        r_adj = 1.0 + factor * 0.15
        b_adj = 1.0 - factor * 0.15
        if len(bands) >= 3:
            bands[0] = bands[0].point(lambda x: min(255, int(x * r_adj)))
            bands[2] = bands[2].point(lambda x: min(255, int(x * b_adj)))
        if len(bands) == 4:
            img = Image.merge("RGBA", tuple(bands))
        else:
            img = Image.merge("RGB", tuple(bands[:3]))

    elif ft == "vignette":
        # Darken edges
        intensity = max(0.0, min(1.0, intensity))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if has_alpha else "RGB")
        w, h = img.size
        cx, cy = w / 2, h / 2
        max_dist = (cx**2 + cy**2) ** 0.5
        pixels = img.load()
        for y in range(h):
            for x in range(w):
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                factor = 1.0 - intensity * (dist / max_dist) ** 1.5
                factor = max(0.0, factor)
                if img.mode == "RGBA":
                    r, g, b, a = pixels[x, y]
                    pixels[x, y] = (
                        int(r * factor),
                        int(g * factor),
                        int(b * factor),
                        a,
                    )
                else:
                    r, g, b = pixels[x, y]
                    pixels[x, y] = (
                        int(r * factor),
                        int(g * factor),
                        int(b * factor),
                    )

    elif ft == "rotate":
        img = img.rotate(-intensity, expand=True, resample=Image.BICUBIC)

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown filter '{filter_type}'. "
            f"Available: grayscale, sepia, blur, sharpen, edge_enhance, emboss, "
            f"contour, smooth, invert, brightness, contrast, saturation, warmth, "
            f"vignette, rotate",
        )

    out_name = _unique_name("jpg")
    return _save_and_return(img, out_name)


# ---------------------------------------------------------------------------
# 3. Preview (returns base64-encoded JPEG for live preview)
# ---------------------------------------------------------------------------

@app.post("/api/preview")
async def preview_filter(
    file: UploadFile = File(...),
    filter_type: str = Form(...),
    intensity: float = Form(1.0),
):
    """Same as /api/filter but returns a base64 data-URI for instant preview."""
    try:
        contents = await file.read()
        img = Image.open(io.BytesIO(contents))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read image: {e}")

    # Re-use the same filter logic by calling the filter endpoint's core
    # For simplicity, we duplicate the dispatch here (could be refactored).
    has_alpha = img.mode in ("RGBA", "LA", "PA")
    ft = filter_type.lower().strip()

    if ft == "grayscale":
        img = ImageOps.grayscale(img)
        if has_alpha:
            img = img.convert("RGBA")
    elif ft == "sepia":
        gray = ImageOps.grayscale(img)
        sepia_data = []
        for px in gray.getdata():
            r = min(255, int(px * 1.2))
            g = min(255, int(px * 0.95))
            b = min(255, int(px * 0.7))
            sepia_data.append((r, g, b))
        img = Image.new("RGB", gray.size)
        img.putdata(sepia_data)
    elif ft == "blur":
        radius = max(0.5, intensity * 5)
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    elif ft == "sharpen":
        for _ in range(max(1, int(intensity))):
            img = img.filter(ImageFilter.SHARPEN)
    elif ft == "edge_enhance":
        img = img.filter(ImageFilter.EDGE_ENHANCE)
    elif ft == "emboss":
        img = img.filter(ImageFilter.EMBOSS)
    elif ft == "contour":
        img = img.filter(ImageFilter.CONTOUR)
    elif ft == "smooth":
        img = img.filter(ImageFilter.SMOOTH)
    elif ft == "invert":
        if img.mode in ("RGBA", "LA"):
            r, g, b, a = img.split()
            r = ImageOps.invert(r)
            g = ImageOps.invert(g)
            b = ImageOps.invert(b)
            img = Image.merge("RGBA", (r, g, b, a))
        else:
            img = ImageOps.invert(img.convert("RGB"))
    elif ft == "brightness":
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(max(0.0, intensity))
    elif ft == "contrast":
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(max(0.0, intensity))
    elif ft == "saturation":
        enhancer = ImageEnhance.Color(img)
        img = enhancer.enhance(max(0.0, intensity))
    elif ft == "warmth":
        factor = max(-1.0, min(1.0, intensity))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if has_alpha else "RGB")
        bands = list(img.split())
        r_adj = 1.0 + factor * 0.15
        b_adj = 1.0 - factor * 0.15
        if len(bands) >= 3:
            bands[0] = bands[0].point(lambda x: min(255, int(x * r_adj)))
            bands[2] = bands[2].point(lambda x: min(255, int(x * b_adj)))
        if len(bands) == 4:
            img = Image.merge("RGBA", tuple(bands))
        else:
            img = Image.merge("RGB", tuple(bands[:3]))
    elif ft == "vignette":
        intensity_val = max(0.0, min(1.0, intensity))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if has_alpha else "RGB")
        w, h = img.size
        cx, cy = w / 2, h / 2
        max_dist = (cx**2 + cy**2) ** 0.5
        pixels = img.load()
        for y in range(h):
            for x in range(w):
                dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                factor = 1.0 - intensity_val * (dist / max_dist) ** 1.5
                factor = max(0.0, factor)
                if img.mode == "RGBA":
                    r, g, b, a = pixels[x, y]
                    pixels[x, y] = (int(r * factor), int(g * factor), int(b * factor), a)
                else:
                    r, g, b = pixels[x, y]
                    pixels[x, y] = (int(r * factor), int(g * factor), int(b * factor))
    elif ft == "rotate":
        img = img.rotate(-intensity, expand=True, resample=Image.BICUBIC)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown filter '{filter_type}'.")

    # Encode to base64 JPEG
    buf = io.BytesIO()
    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    img.save(buf, format="JPEG", quality=85)
    import base64
    b64 = base64.b64encode(buf.getvalue()).decode()
    return JSONResponse({"data_uri": f"data:image/jpeg;base64,{b64}"})


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


# ---------------------------------------------------------------------------
# Serve frontend static files & SPA fallback
# ---------------------------------------------------------------------------

if FRONTEND_DIR.exists() and FRONTEND_DIR.is_dir():
    # Mount static assets (CSS, JS, images) at /static
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str = ""):
        """Serve frontend files; fall back to index.html for SPA routing."""
        file_path = FRONTEND_DIR / full_path

        # If the request is for a real file, serve it
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)

        # Otherwise serve index.html
        index_path = FRONTEND_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)

        raise HTTPException(status_code=404, detail="Frontend not found")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)