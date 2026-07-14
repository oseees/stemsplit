/**
 * ImageForge – Frontend Logic
 * Handles upload, preview, conversion, and filter application.
 */

const API_BASE = "";  // relative URLs — works when served from same origin

// ---- DOM refs ----
const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("fileInput");
const fileNameEl = document.getElementById("fileName");
const previewSection = document.getElementById("previewSection");
const toolsSection = document.getElementById("toolsSection");
const originalPreview = document.getElementById("originalPreview");
const resultPreview = document.getElementById("resultPreview");
const convertBtn = document.getElementById("convertBtn");
const filterGrid = document.getElementById("filterGrid");
const applyFilterBtn = document.getElementById("applyFilterBtn");
const intensityControl = document.getElementById("intensityControl");
const intensitySlider = document.getElementById("intensitySlider");
const intensityValue = document.getElementById("intensityValue");
const statusBar = document.getElementById("statusBar");
const statusText = document.getElementById("statusText");
const spinner = document.getElementById("spinner");

let currentFile = null;
let selectedFilter = null;

// ---- Filter definitions ----
const FILTERS = [
    { id: "grayscale",   label: "Grayscale",   hasIntensity: false },
    { id: "sepia",       label: "Sepia",       hasIntensity: false },
    { id: "blur",        label: "Blur",        hasIntensity: true,  min: 0.1, max: 3, step: 0.1, default: 1 },
    { id: "sharpen",     label: "Sharpen",     hasIntensity: true,  min: 1,   max: 5, step: 1,   default: 1 },
    { id: "edge_enhance",label: "Edge Enhance",hasIntensity: false },
    { id: "emboss",      label: "Emboss",      hasIntensity: false },
    { id: "contour",     label: "Contour",     hasIntensity: false },
    { id: "smooth",      label: "Smooth",      hasIntensity: false },
    { id: "invert",      label: "Invert",      hasIntensity: false },
    { id: "brightness",  label: "Brightness",  hasIntensity: true,  min: 0,   max: 3, step: 0.05, default: 1 },
    { id: "contrast",    label: "Contrast",    hasIntensity: true,  min: 0,   max: 3, step: 0.05, default: 1 },
    { id: "saturation",  label: "Saturation",  hasIntensity: true,  min: 0,   max: 3, step: 0.05, default: 1 },
    { id: "warmth",      label: "Warmth",      hasIntensity: true,  min: -1,  max: 1, step: 0.05, default: 0 },
    { id: "vignette",    label: "Vignette",    hasIntensity: true,  min: 0,   max: 1, step: 0.05, default: 0.5 },
    { id: "rotate",      label: "Rotate",      hasIntensity: true,  min: -180, max: 180, step: 1, default: 90 },
];

// ---- Build filter chips ----
function buildFilterGrid() {
    filterGrid.innerHTML = "";
    FILTERS.forEach((f) => {
        const chip = document.createElement("button");
        chip.className = "filter-chip";
        chip.textContent = f.label;
        chip.dataset.filter = f.id;
        chip.addEventListener("click", () => selectFilter(f, chip));
        filterGrid.appendChild(chip);
    });
}

function selectFilter(filterDef, chipEl) {
    // Toggle
    if (selectedFilter === filterDef.id) {
        // Deselect
        selectedFilter = null;
        document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
        intensityControl.style.display = "none";
        applyFilterBtn.disabled = true;
        return;
    }

    selectedFilter = filterDef.id;
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    chipEl.classList.add("active");

    if (filterDef.hasIntensity) {
        intensityControl.style.display = "flex";
        intensitySlider.min = filterDef.min;
        intensitySlider.max = filterDef.max;
        intensitySlider.step = filterDef.step;
        intensitySlider.value = filterDef.default;
        intensityValue.textContent = parseFloat(filterDef.default).toFixed(2);
    } else {
        intensityControl.style.display = "none";
    }

    applyFilterBtn.disabled = false;
}

// ---- Intensity slider ----
intensitySlider.addEventListener("input", () => {
    intensityValue.textContent = parseFloat(intensitySlider.value).toFixed(2);
});

// ---- Upload handling ----
uploadZone.addEventListener("click", () => fileInput.click());

uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
});

uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("drag-over");
});

uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

function handleFile(file) {
    if (!file.type.startsWith("image/")) {
        showStatus("Please select a valid image file.", "error");
        return;
    }
    currentFile = file;
    fileNameEl.textContent = file.name;
    previewSection.style.display = "flex";
    toolsSection.style.display = "grid";

    // Show original preview
    const reader = new FileReader();
    reader.onload = (e) => {
        originalPreview.src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Reset result
    resultPreview.src = "";
    selectedFilter = null;
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    intensityControl.style.display = "none";
    applyFilterBtn.disabled = true;
    hideStatus();
}

// ---- Convert to JPG ----
convertBtn.addEventListener("click", async () => {
    if (!currentFile) return;
    showStatus("Converting to JPG...", "loading");

    const formData = new FormData();
    formData.append("file", currentFile);

    try {
        const res = await fetch(`${API_BASE}/api/convert`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Conversion failed");
        }
        const blob = await res.blob();
        downloadBlob(blob, replaceExtension(currentFile.name, "jpg"));
        showStatus("Conversion complete! Download started.", "success");

        // Show result preview
        const url = URL.createObjectURL(blob);
        resultPreview.src = url;
    } catch (err) {
        showStatus(err.message, "error");
    }
});

// ---- Apply Filter ----
applyFilterBtn.addEventListener("click", async () => {
    if (!currentFile || !selectedFilter) return;
    showStatus(`Applying ${selectedFilter} filter...`, "loading");

    const formData = new FormData();
    formData.append("file", currentFile);
    formData.append("filter_type", selectedFilter);
    formData.append("intensity", intensitySlider.value);

    try {
        const res = await fetch(`${API_BASE}/api/filter`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Filter failed");
        }
        const blob = await res.blob();
        downloadBlob(blob, replaceExtension(currentFile.name, "jpg"));
        showStatus("Filter applied! Download started.", "success");

        const url = URL.createObjectURL(blob);
        resultPreview.src = url;
    } catch (err) {
        showStatus(err.message, "error");
    }
});

// ---- Live preview on slider change (debounced) ----
let previewTimeout;
intensitySlider.addEventListener("input", () => {
    if (!currentFile || !selectedFilter) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => livePreview(), 300);
});

// Also trigger on filter selection
const origSelectFilter = selectFilter;
selectFilter = function (filterDef, chipEl) {
    origSelectFilter(filterDef, chipEl);
    if (currentFile && selectedFilter) {
        livePreview();
    }
};

async function livePreview() {
    if (!currentFile || !selectedFilter) return;
    const formData = new FormData();
    formData.append("file", currentFile);
    formData.append("filter_type", selectedFilter);
    formData.append("intensity", intensitySlider.value);

    try {
        const res = await fetch(`${API_BASE}/api/preview`, {
            method: "POST",
            body: formData,
        });
        if (!res.ok) return;
        const data = await res.json();
        resultPreview.src = data.data_uri;
    } catch {
        // Silently fail for preview
    }
}

// ---- Helpers ----
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function replaceExtension(filename, newExt) {
    const dot = filename.lastIndexOf(".");
    if (dot === -1) return filename + "." + newExt;
    return filename.substring(0, dot) + "." + newExt;
}

function showStatus(msg, type) {
    statusBar.style.display = "flex";
    statusText.textContent = msg;
    statusText.style.color = type === "error" ? "var(--danger)" : type === "success" ? "var(--success)" : "var(--text-muted)";
    spinner.style.display = type === "loading" ? "block" : "none";
}

function hideStatus() {
    statusBar.style.display = "none";
}

// ---- Init ----
buildFilterGrid();