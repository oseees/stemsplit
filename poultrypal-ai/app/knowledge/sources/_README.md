# Knowledge sources

These markdown files are the **knowledge base** the diagnosis engine retrieves from.
Drugs/treatments shown to farmers come **only** from text in these files — the model
cannot invent one.

> ⚠️ **The shipped files are UNVERIFIED SAMPLES** written from general poultry-health
> knowledge to make the pipeline demonstrable. They contain no dosages. **Before any real
> use, replace them with vet-reviewed sources** (e.g. FAO/WOAH manuals, USDA, university
> extension publications) — drop `.md`, `.txt`, or `.pdf` files here and run
> `python -m app.knowledge.ingest` (or POST `/api/reindex`).

File convention: one disease per file. The first `# Heading` becomes the citation title.
