# Plan: Browser-Based Kinematic Linkage Visualizer

## TL;DR
Build a **100% client-side, drawing-app-style kinematic simulator** with:
- **Kinematic Engine**: Numerical constraint solver for closed-loop stick chains driven by rotating discs
- **Visualization**: Canvas 2D rendering of discs, sticks, and pencil traces with fade-out persistence
- **UI**: Drawing tools (Add Disc → Add Stick → Add Pencil) to build the system, then playback with real-time parameter tuning
- **Trace System**: Pencils continuously draw on sticks; traces fade over configurable persistence duration

No framework overhead. System must ensure movement exists and solution is unique (no degenerate constraints).

---

## Steps

### Phase 1: Project Setup & Data Model
1. **Initialize project structure**
   - `index.html` — canvas + drawing toolbar
   - `src/engine/` — kinematic solver
   - `src/renderer/` — Canvas 2D visualization
   - `src/ui/` — drawing tools, playback controls
   - `src/models/` — Disc, StickChain, Pencil, System classes
   - `src/utils/` — math, constraint solver

2. **Define system data model**
   - `Disc`: position (x, y), radius, rotation speed (rpm), current angle
   - `Stick`: length, attachment point on source (distance from start), joint position on source
   - `StickChain`: array of sticks {0..M}, start attachment (Disc or Stick), end attachment (Stick)
   - `Pencil`: stick reference, position on stick, color, persistence_duration
   - `System`: collection of Discs, StickChains, Pencils (max: 4 discs, 3 sticks/chain, 3 pencils)
   - Constraint validation: system must have unique kinematic solution (no degeneracy)

### Phase 2: Drawing UI (Builder Mode)
3. **Implement drawing tools** (*depends on Phase 1*)
   - Tool state machine: idle → Add-Disc → Add-Stick → Add-Pencil → Play
   - **Add Disc tool**: click to place disc center, drag to set radius, input rpm
   - **Add Stick tool**: click source (disc/stick), click target attachment point, input stick length
   - **Add Pencil tool**: click stick, click position on stick, right-click for color picker + persistence input
   - Visual feedback: highlight valid attachment points, show preview

4. **Build system editing UI** (*parallel with step 3*)
   - Edit mode toggle: allow in-place radius/rpm/length adjustments before playback
   - Delete tool: right-click on element to remove
   - System validation: warn if constraints are degenerate or unsolvable

### Phase 3: Kinematic Solver Engine
5. **Implement numerical constraint solver** (*depends on Phase 1*)
   - `KinematicSolver` class: given disc angles, solve for all stick angles
   - Constraint equations: for each stick chain, enforce angle constraints at revolute joints
   - Solver: iterative (Gauss-Newton) to find consistent stick angles
   - Detect degeneracy: warn if solver fails to converge or has multiple solutions
   - State output: array of stick angles, pencil world positions

6. **Time integration loop** (*depends on step 5*)
   - At each frame: increment disc angles by (rpm / 60) * (dt / 1000)
   - Call solver to compute stick angles
   - Compute pencil world positions from stick angles
   - Feed to renderer

### Phase 4: Canvas Rendering
7. **Implement Canvas renderer** (*depends on Phase 3*)
   - `CanvasRenderer` class: draw discs, sticks, pencil traces
   - Discs: filled circles with rotation indicator (line from center)
   - Sticks: line segments connecting joints
   - Pencils: small dot at current position
   - Animation loop: `requestAnimationFrame`

8. **Pencil trace rendering** (*depends on step 7*)
   - Maintain trace buffer per pencil: deque of {position, timestamp, color}
   - On each frame: add new position to buffer
   - Render all buffered positions; fade alpha based on age
   - Discard positions older than persistence_duration
   - Clear trails button: empty all trace buffers

### Phase 5: Playback & Parameter Control
9. **Playback controls** (*depends on Phases 4, 5*)
   - Buttons: Play, Pause, Reset (return to initial state)
   - Speed slider: scale dt by factor (e.g., 0.5x to 2x)
   - Time display: show elapsed simulation time

10. **Real-time parameter tuning** (*depends on step 9*)
    - During playback, allow live edits to disc rpm, stick lengths, attachment positions
    - Ramp-up smoothing: changes interpolate over 2 seconds (configurable buffer)
    - Constraint re-validation on each edit
    - Pencil persistence also adjustable in real-time

### Phase 6: Integration & Testing
11. **Integrate builder + solver + renderer** (*depends on Phases 2–5*)
    - State machine: Builder mode → Play mode
    - Ensure system validation happens before entering Play
    - All modules communicate through System state object

12. **Testing & validation** (*depends on Phase 6*)
    - Manual testing: build simple systems (2-disc with 1-stick), verify rotation
    - Constraint solver: test with known kinematic chains (Watt linkage, etc.)
    - Trace persistence: verify fade timing matches persistence_duration
    - Real-time tuning: adjust rpm, verify smooth response
    - Edge cases: degenerate constraints, maximum oscillation speeds

---

## Relevant Files
- **Entry point**: `index.html` — canvas + drawing toolbar
- **Data models**: `src/models/Disc.js`, `StickChain.js`, `Pencil.js`, `System.js` — system state
- **Solver**: `src/engine/KinematicSolver.js` — numerical constraint solver for closed-loop chains
- **Rendering**: `src/renderer/CanvasRenderer.js` — Canvas 2D: discs, sticks, pencil traces
- **Drawing tools**: `src/ui/DrawingTools.js` — Add Disc/Stick/Pencil tools, tool state machine
- **Playback**: `src/ui/PlaybackControls.js` — Play/Pause/Reset, speed, parameter tuning with ramp-up
- **Math utils**: `src/utils/math.js` — vector ops, constraint utilities
- **Main app**: `src/app.js` — orchestrates builder mode → play mode

---

## Verification
1. **Data model & builder**
   - All constraints are created without degeneracy (solver validation works)
   - Drawing tools correctly capture disc, stick, pencil parameters
   - Editing parameters in builder mode updates System state

2. **Kinematic solver**
   - Simple linkages (2-disc + 1-stick chain) produce expected motion
   - Closed-loop chains solve consistently (no discontinuities in angles)
   - Solver detects and warns on degenerate configurations

3. **Rendering & traces**
   - Discs rotate visibly at specified rpm
   - Sticks move smoothly as disc drives them through constraints
   - Pencil traces appear and fade over persistence_duration
   - Clear trails button correctly empties all buffers

4. **Playback & real-time tuning**
   - Play/Pause/Reset buttons work correctly
   - Speed slider scales motion (2x speed = 2x angular velocity)
   - Real-time parameter edits (rpm, stick length) interpolate smoothly over 2-second ramp
   - Constraint re-validation on parameter change

5. **Performance**
   - 60 FPS on typical 4-disc, 3-pencil system
   - Smooth trace rendering with multiple pencils (no jitter)

---

## Decisions & Scope
- **Closed-loop constraints**: System may form constraint loops (multiple stick chains interconnected). Engine ensures solution exists and is unique.
- **Collisions**: Ignored (sticks pass through each other).
- **No server**: Static file serve (e.g., `python -m http.server`).
- **Vanilla JS**: No frameworks, direct DOM manipulation.
- **Prototyping limits**: max 4 discs, 3 sticks/chain, 3 pencils.
- **Real-time tuning**: 2-second ramp-up buffer for smooth parameter transitions.
- **Initial state**: System starts with discs at angle 0°, sticks in equilibrium position, pencils ready to trace.

---

## Implementation Status ✅

**Phase 1-5: COMPLETE** — All core modules implemented:
- ✅ Project structure & data models (Disc, Stick, StickChain, Pencil, System)
- ✅ index.html with canvas + toolbar + modal dialogs
- ✅ KinematicSolver with Gauss-Newton constraint solver
- ✅ CanvasRenderer with disc, stick, pencil trace rendering
- ✅ DrawingTools UI (Add Disc → Add Stick → Add Pencil workflow)
- ✅ PlaybackControls (Play, Pause, Reset, Speed slider)
- ✅ App orchestration & animation loop
- ✅ All script imports in correct dependency order

**Files created**: 11 JS modules + 1 HTML + 1 plan.md, ~2500 LOC total, zero syntax errors.

**Next Phase: Testing & Debugging**
1. Launch app in browser (python -m http.server or VS Code Live Server)
2. Verify rendering pipeline (canvas draws discs, sticks, pencils)
3. Test drawing tools: create simple 2-disc + 1-stick system
4. Validate kinematic solver convergence
5. Test playback & speed control
6. Trace rendering & fade-out timing