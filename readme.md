# spiroGrapher_NRJ

Browser-based **kinematic linkage** lab: rotating discs and screens, stick chains, anchors, sliders, and pencils that leave canvas traces—similar in spirit to a spirograph / linkage playground. The UI is plain HTML and a 2D canvas; simulation time steps call a selectable solver (`src/app.js`, default **Hybrid**).

## Quick start

1. Start the local dev server (Python 3): see **Local dev server** below.
2. Open **`http://localhost:8000/`** in a modern browser so scripts and the `ml-matrix` CDN load correctly.

No npm install or bundler is required; scripts are loaded in order from `index.html`.

## Stack

| Piece | Role |
| --- | --- |
| **Vanilla JavaScript** | Global classes; no ES module bundling. |
| **HTML5 Canvas** | Rendering (`src/renderer/CanvasRenderer.js`). |
| **ml-matrix** (jsDelivr) | Dense linear algebra for iterative solvers (`index.html`). |
| **Python** | Optional `dev_server.py` for cache-safe local HTTP. |

## Source map

| Path | Responsibility |
| --- | --- |
| `src/models/` | Scene graph: `System`, discs, screens, `Stick` / `StickChain`, `Anchor`, `Slider`, `Pencil`. |
| `src/engine/` | `KinematicSolver`, `EnergySolver`, `HybridSolver`—mutually exclusive backends per UI mode. |
| `src/renderer/` | Canvas drawing and view transforms. |
| `src/ui/` | Drawing tools, playback controls, sidebar wiring. |
| `src/config.js` | Solver limits, simulation defaults, colors, validation caps. |

## Local dev server

This project ships with a tiny local dev server that disables browser caching,
which helps avoid stale-file mismatches during normal refreshes.

For `cmd.exe`:

- Start in a separate terminal: `start_dev_server.cmd`
- Stop the server on port 8000: `stop_dev_server.cmd`
- Run in the current terminal: `python dev_server.py`
- Stop when running in the current terminal: `Ctrl+C`

Server URL: `http://localhost:8000/`

---

## Kinematic-based formulation of the system

**Role:** Pure kinematic **feasibility** solve: find stick orientations that satisfy geometric constraints for the current drive angles.

- Unknowns are **stick angles** along chains; the implementation is a **warm-started Gauss–Newton** least-squares loop with a numerically estimated Jacobian, **damping**, and **backtracking** so each step reduces the residual norm (`KinematicSolver.js`).
- Residuals encode linkage / attachment errors; the solver validates the system and **constraint sufficiency** before iterating and reports issues such as singular Jacobians or non-decreasing residuals.
- Depends on **`ml-matrix`** for the normal-equation linear solve each iteration.

---

## Energy-based formulation of the system

**Role:** Treat the mechanism as a **compliant network**: joint positions are adjusted to minimize squared constraint violations weighted by stiffness-like parameters.

- Unknowns are **free node positions** in the plane (not stick angles); topology collects chains, **spring-like segments** (rest length and stiffness), **anchors**, **slider** constraints, and **soft** disc attachments (`EnergySolver.js` header and `buildTopology`).
- Same broad pattern as the kinematic branch—**Gauss–Newton / least squares** with finite-difference Jacobian and line search—but the residual stack reflects **elastic penalties** rather than a pure angle-space loop.
- Useful when you want **spatial compliance** (stretching, soft anchors) expressed as an energy-like objective.

---

## Hybrid-based formulation of the system

**Role:** **Default** solver in `app.js` (`solverMode = 'hybrid'`). **XPBD-style** constraint projection on a mass-node graph with optional **substepped dynamics** when a real time step is provided.

- **Per-segment axial rigidity** is tied to an **EA-style** interpretation, not a naive scalar spring; internal **virtual nodes** split sticks when attachments land mid-segment (`HybridSolver.js` file comment).
- **Compliant distance constraints** keep persistent **Lagrange multipliers (lambdas)** so the state carries **tension history**; **bending** constraints couple neighbors for smoother curvature.
- With a finite `dt`, the solver **integrates** free nodes and soft discs, then **projects** constraints over several **substeps**; without `dt` it still refreshes fixed kinematic attachments and projects—suited for interactive scrubbing as well as playback.
