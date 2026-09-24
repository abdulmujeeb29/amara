# Amara design preview

Run from the project root:

```sh
python3 -B scripts/preview_design.py --port 8765
```

Open **http://localhost:8765/** on this computer.

The preview uses the public Mapbox token from `.env` for its basemap. Without a usable token/network/WebGL, a labelled illustration remains visible. All reports, sources, route estimates, AI output, and movement are fictional design fixtures.

Try the compact overview update, source details, and **Check my way home** to reveal walking/driving and journey controls. **Elsewhere nearby** expands secondary reports. **Explore 3D** brings buildings closer with a stronger camera tilt.

Open **Mock preview** in the header for all 14 scenarios, **New evidence**, and **Reset demo**. These controls stay out of the normal reading experience. GSAP adds short optional transitions and respects reduced-motion preferences; the app remains usable if its animation library cannot load.

The journey is two steps: choose destination/mode, then review one concise route briefing. If 3D cannot run, Amara automatically shows a **real 2D street map** using DOM image tiles and SVG overlays, with pan/zoom, incident markers, and the same journey controls. No graphics-setting change is required for that mode. If imagery also fails, the map notice explains it while the briefing stays available.

Force the non-WebGL experience for review: **http://localhost:8765/?map=2d#/journey**. The preview's `/raster/z/x/y.png` endpoints fetch Mapbox imagery with bounded in-memory caching; geographic data still requires a valid token and network access.

No Django app, database writes, live incident retrieval, or real location tracking is started by this preview. See `docs/DESIGN_HANDOFF.md` for the production handoff and `docs/reviews/PHASE_1.md` for review results.
