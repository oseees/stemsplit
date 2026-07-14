# ImageForge – Image Converter & Filter Web App

Convert any image format (PNG, WEBP, BMP, TIFF, GIF, and more) to high-quality **JPG**, and apply **15+ stunning filters** — all through a modern, drag-and-drop web interface.

## Features

- **Format Conversion** — PNG, WEBP, BMP, TIFF, GIF, ICO, and more → JPG
- **15+ Filters** — Grayscale, Sepia, Blur, Sharpen, Edge Enhance, Emboss, Contour, Smooth, Invert, Brightness, Contrast, Saturation, Warmth, Vignette, Rotate
- **Live Preview** — See filter results instantly before downloading
- **Adjustable Intensity** — Fine-tune filter strength with sliders
- **Drag & Drop** — Simple, modern UI
- **Batch-Ready API** — RESTful backend built with FastAPI

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Python 3.10+, FastAPI, Pillow       |
| Frontend | Vanilla HTML5, CSS3, JavaScript     |
| Server   | Uvicorn (ASGI)                      |

## Project Structure

```
image-converter/
├── backend/
│   ├── main.py              # FastAPI server (conversion + filter endpoints)
│   ├── requirements.txt     # Python dependencies
│   └── uploads/             # Temporary output directory
├── frontend/
│   ├── index.html           # Main page
│   ├── style.css            # Styles (dark theme)
│   └── script.js            # Client-side logic
└── README.md
```

## Quick Start

### 1. Enter the project

```bash
cd image-converter/backend
```

### 2. Create virtual environment & install dependencies

```bash
python3 -m venv venv
source venv/bin/activate       # macOS/Linux
# venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

### 3. Run the server

```bash
python main.py
```

### 4. Open in browser

Visit **http://localhost:8000** — the frontend UI and API are both served from a single server.

## API Endpoints

| Method | Endpoint       | Description                                      |
|--------|----------------|--------------------------------------------------|
| `POST` | `/api/convert` | Upload an image → returns converted JPG          |
| `POST` | `/api/filter`  | Upload + `filter_type` + `intensity` → filtered JPG |
| `POST` | `/api/preview` | Same as filter but returns base64 data-URI       |
| `GET`  | `/api/health`  | Health check                                     |

### Supported `filter_type` values

`grayscale`, `sepia`, `blur`, `sharpen`, `edge_enhance`, `emboss`, `contour`, `smooth`, `invert`, `brightness`, `contrast`, `saturation`, `warmth`, `vignette`, `rotate`

## License

MIT