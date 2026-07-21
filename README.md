# LinkedIn Story Pipeline — Web Edition

A zero-cost, zero-backend static site that turns a raw idea into a
finished, on-voice LinkedIn post, and keeps sharpening its understanding
of a person's voice over time by comparing drafts against what they
actually publish.

Full architecture, storage schema, onboarding flow, and phase breakdown
live in [BUILD_SPEC_WEB.md](BUILD_SPEC_WEB.md).

## Status

Phase 1 scaffold — file layout and hosting are in place; feature work
lands phase by phase per the build spec.

## Running locally

No build step. Serve the repo root with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` (user-facing app) or
`http://localhost:8000/admin.html` (link generator).

## Deployment

Static hosting via GitHub Pages, serving directly from the repo root on
`main`.
