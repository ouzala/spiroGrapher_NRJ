# HybridSolver Model Summary

This document summarizes the **hybrid** solver branch centered on [src/engine/HybridSolver.js]. It describes how the mechanism is represented as a mass-node graph, how constraints are enforced in an XPBD-style projection loop, and how optional substep integration couples **soft** disc drives with compliant stick networks.

### HYBRID (XPBD) REFORMULATION OF THE SPYROGRAPHER MODEL
--> Sticks become chains of point masses linked by **distance constraints** with optional **compliance** (including an **EA / rest-length** interpretation for axial rigidity).
--> **Hard** kinematic attachments (hard-driven disc/screen starts, sliders) versus **soft** attachments (finite-torque discs, coincident anchor targets) are separated in the constraint schedule.
--> **Persistent multipliers** $(\lambda)$ on compliant constraints carry **tension memory** across substeps; **bending** and **straightness** add higher-order shape control.
--> Unlike the energy branch, there is **no global Gauss–Newton Jacobian** over all unknowns; stability comes from **iterated local projections** and (when playing) **explicit semi-implicit integration** with damping.

## 0. Purpose

The hybrid model is the **default** simulation path in [src/app.js] (`solverMode = 'hybrid'`). It targets **interactive** mechanisms where:

- some parts should feel **nearly rigid** while others remain **visibly compliant**;
- **finite-torque** discs should not be treated as infinitely stiff rotational actuators;
- **mid-stick anchors and sliders** should split geometry into **virtual nodes** rather than relying on fragile one-shot interpolation;
- **lightweight dynamics** (node inertia, soft disc lag) improve continuity between frames compared with a pure equilibrium solve.

Conceptually, each solve step alternates:

1. (optional) **predict** free node positions and soft disc angles from current velocities and drives;
2. **project** constraints several times (Gauss–Seidel-style sweeps) with XPBD-style compliance;
3. (optional) **derive** new velocities from position changes.

When the editor calls `solve({ dtMs: 0 })` ([src/ui/DrawingTools.js]), the solver skips prediction integration and only refreshes kinematic anchors before projecting, which yields a **quasi-static** configuration useful while editing.

## 1. Overview

### 1.1 Graph state

The mechanism is represented by a set of planar nodes $i$ with positions $\mathbf{x}_i \in \mathbb{R}^2$, velocities $\mathbf{v}_i$, masses $m_i$, and inverse masses $w_i = m_i^{-1}$ (with $w_i = 0$ for kinematically driven nodes).

Sticks are subdivided into one or more **segments** between consecutive nodes. Each segment carries a **rest length** $L$ and an **axial rigidity** $EA$ (implemented as `axialRigidity` derived from the user-facing stiffness percentage via [src/config.js]).

### 1.2 XPBD-style distance constraint

For a segment between nodes $a$ and $b$, define the scalar constraint:

$$
C(\mathbf{x}_a, \mathbf{x}_b) = \|\mathbf{x}_b - \mathbf{x}_a\| - L .
$$

In the spirit of XPBD, a **compliance** $\alpha \ge 0$ maps material softness to a constraint softness scaled by the time step. The implementation uses an effective parameter

$$
\tilde{\alpha} = \frac{\alpha}{\Delta t^2}
$$

(with a small floor on $\Delta t^2$ for numerical safety) when accumulating the denominator for the Lagrange multiplier increment (see Section 8.2).

Compliance $\alpha = 0$ recovers an **equality** distance correction within the inner iteration loop (no persistent $\lambda$ accumulation for that constraint key).

### 1.3 Axis-aligned point constraints

Point targets (world $x$ or $y$) and **coincidence** between two nodes are handled as **scalar** constraints:

$$
C = p_a - p_b
$$

where $p$ is either the $x$ or $y$ coordinate, and $p_b$ may be a fixed target instead of a second node. The same XPBD increment pattern applies with appropriate inverse-mass weights.

### 1.4 Total loop structure

Over each outer **substep** $\Delta t / N_s$ (with $N_s =$ `SUBSTEPS` when playing, otherwise a single substep with an internal nominal $\Delta t$ for compliance scaling):

$$
\text{advance soft discs} \;\rightarrow\; \text{integrate free nodes} \;\rightarrow\; \text{project constraints (}N_c\text{ sweeps)} \;\rightarrow\; \text{update velocities}
$$

where $N_c =$ `MAX_ITERATIONS` in the current code (naming inherited from other solvers; here it counts **constraint iterations per substep**).

---

### 1.5. Notes

* This is **not** a full rigid multibody simulator with joints expressed in reduced coordinates; unknowns live in the **full Cartesian** picture.
* **Hard-driven** discs still follow the kinematic prescription in [src/app.js] / [src/models/Disc.js]: `advanceDiscAngles` calls `updateDriveTarget`, which sets `driveTargetAngle` from RPM and, when `isHardDriven()`, immediately assigns `angle = driveTargetAngle`. **Soft** discs keep their integrated `angle` / `angularVelocity` and evolve further inside `HybridSolver.advanceSoftDiscs`.
* Reported **energy** in `computeMetrics` is a **diagnostic** spring energy from segment stretch, not a strict Lyapunov function of the projection loop.

## 2. High-Level Architecture

The model is distributed across:

- [src/engine/HybridSolver.js]: topology build, integration, constraint projection, metrics, persistence of dynamic state.
- [src/models/System.js]: owns discs, stick chains, anchors, sliders, pencils, validation, attachment typing.
- [src/models/Disc.js] / [src/models/Screen.js]: rotating surfaces, `isHardDriven()`, torque ratio, drive targets.
- [src/models/Stick.js]: rest length, stiffness percentage, rendered endpoints, strain/tension fields updated after projection.
- [src/models/StickChain.js]: ordered sticks, start/end attachments.
- [src/models/Anchor.js]: manual couplings resolved to coincidence constraints when both ends map to graph nodes.
- [src/models/Slider.js]: hard positional coupling to a target attachment or fixed point.
- [src/config.js]: `HYBRID_SOLVER` constants (iteration counts, damping, compliance scales, bending).
- [src/app.js]: advances **drive targets** for all rotating bodies in hybrid mode, then calls `solver.solve({ dtMs, timeScale })`.

## 3. Topology Construction

Each `solve()` begins with `buildTopology()`, producing an ephemeral graph containing:

| Field | Meaning |
| --- | --- |
| `nodes` | Mass points with positions, velocities, optional `fixedAttachment`. |
| `segments` | Distance constraints between consecutive nodes on a (possibly split) stick. |
| `renderedSticks` | Mapping from logical `Stick` to endpoint nodes and segment list for commit. |
| `hardPositionConstraints` | Slider pins and kinematic chain starts (hard disc/screen + fixed point semantics). |
| `hardAnchorConstraints` | Manual anchors only ([src/models/Anchor.js]): same payload shape as coincidence (node–node or node–target), always scheduled in the **early hard** projection tier (see §8.1). |
| `softPositionConstraints` | Chain starts on **finite-torque** discs/screens (compliant positioning). |
| `nodeCoincidenceConstraints` | **Chain end** attachments only (non–`openEnd`): node–node or node–target coincidence with zero compliance. |
| `bendingConstraints` | Triples of nodes on the **original** chain polyline (not only split interior). |
| `straightnessConstraints` | Triples along **split** node sequences inside a single stick for local colinearity control. |
| `softDiscs` | Discs/screens that are not hard-driven; receive angular integration in `advanceSoftDiscs`. |

Topology is rebuilt every solve so edits immediately re-split sticks and refresh constraint keys.

## 4. Virtual Nodes and Mid-Stick Attachments

Whenever an anchor, chain end, or slider references a point strictly **between** stick endpoints, `collectStickSplitFractions()` records the normalized arc parameter

$$
\lambda = \mathrm{clamp}\left(\frac{d}{L_{\text{rest}}}, 0, 1\right)
$$

where $d$ is the attachment distance along the stick.

For each affected stick, `buildTopology()` inserts additional nodes at the interpolated positions and replaces one logical stick with a **chain of segments** whose rest lengths partition $L_{\text{rest}}$ according to consecutive $\lambda$ values.

This is essential for the hybrid branch: **coincidence constraints** can then bind the **same particle** that lies physically on the stick interior, instead of enforcing a soft coupling to a moving interpolated target that would otherwise not be a degree of freedom.

## 5. Mass Model

Segment $s$ contributes mass to its endpoints:

$$
m_s = \rho \, L_s
$$

with linear density $\rho =$ `SEGMENT_DENSITY` and $L_s$ the segment rest length. Each endpoint receives half of $m_s$.

Nodes with a kinematic `fixedAttachment` are assigned **infinite** mass ($w_i = 0$) so integration does not move them; their positions are overwritten from attachment geometry each substep.

## 6. Soft Disc Angular Dynamics

For each soft disc, let $\theta$ be the current angle, $\omega$ the angular velocity, $\theta^\*$ the **drive target** updated elsewhere from RPM, and $\tau \in (0,1]$ a normalized torque ratio from the disc model.

The implementation uses a **second-order-ish lag** in angle error $\Delta = \mathrm{wrap}(\theta^\* - \theta)$:

$$
\omega \leftarrow \omega + k_\theta \, \tau \, \Delta \, \Delta t
$$

$$
\omega \leftarrow \omega \, e^{-\beta \, \Delta t}
$$

$$
\theta \leftarrow \mathrm{wrap}(\theta + \omega \, \Delta t)
$$

with $k_\theta =$ `SOFT_DRIVE_STIFFNESS` and $\beta =$ `DRIVE_ANGULAR_DAMPING`. This is a **phenomenological** follow law, not a full motor + load model, but it creates inertial smoothing distinct from the purely kinematic branches.

## 7. Integration and Global Damping

When `dtMs ≠ 0`, free (non-kinematic) nodes first receive an **explicit** position update from damped velocities:

$$
\mathbf{v}_i \leftarrow e^{-\gamma \, \Delta t} \, \mathbf{v}_i
$$

$$
\mathbf{x}_i \leftarrow \mathbf{x}_i + \mathbf{v}_i \, \Delta t
$$

with $\gamma =$ `GLOBAL_DAMPING`.

Kinematic nodes reset $(\mathbf{x}_i, \mathbf{v}_i)$ from their attachments before projection.

## 8. Constraint Projection Details

### 8.1 Iteration order

Inside `projectConstraints`, each outer iteration sweeps in order:

1. **Hard positional** constraints: sliders and kinematic chain starts (axis pair per constraint).
2. **Hard anchor** constraints: manual anchors only (`hardAnchorConstraints`), using the same scalar solvers as coincidence entries but with **priority** before soft attachments and segment XPBD.
3. **Soft positional** constraints: finite-torque disc/screen chain starts (compliant axis pairs).
4. **Chain-end coincidence** (`nodeCoincidenceConstraints`): end attachments other than `openEnd`.
5. Segment length constraints (axial XPBD, possibly compliant).
6. Bending length constraints (outer nodes of each bending triple).
7. Straightness length constraints (outer nodes of each straightness triple).
8. **Optional anchor refines:** if `ANCHOR_EXTRA_PASSES > 0`, repeat step 2 only that many times after the full sweep (cheap tightening when anchor count is small).

**Compliance vs scheduling:** manual anchors were already **hard** in the XPBD sense ($\alpha = 0$, no persistent $\lambda$ accumulation on those keys). The behavioral change is **Gauss–Seidel ordering**: solving anchors **after** segment length in the old order allowed segment projection to move nodes away from satisfied anchors within the same iteration; promoting anchors to tier (2) plus optional passes (8) reduces that **priority** slip without changing the underlying equality math.

This ordering is a **sequential Gauss–Seidel** flavor: later constraints see updates from earlier ones in the same iteration.

### 8.2 Generic scalar update

For a scalar constraint $C$ with effective compliance scale $\tilde{\alpha} = \alpha / \Delta t^2$, inverse masses $w_a, w_b$ on the participating coordinates, and persistent multiplier $\lambda$, the code implements:

$$
\Delta\lambda = \frac{-C - \tilde{\alpha}\,\lambda}{w_a + w_b + \tilde{\alpha}}
$$

$$
p_a \leftarrow p_a + w_a \, \Delta\lambda, \quad
p_b \leftarrow p_b - w_b \, \Delta\lambda
$$

with sign conventions chosen so that a **positive** length error $C = \|\mathbf{x}_b-\mathbf{x}_a\| - L > 0$ pulls nodes **toward** each other along the edge direction.

For **distance** constraints, the position correction is applied along the unit vector

$$
\mathbf{n} = \frac{\mathbf{x}_b - \mathbf{x}_a}{\|\mathbf{x}_b - \mathbf{x}_a\|}.
$$

When $\alpha = 0$, $\lambda$ is not persisted across iterations (hard XPBD equality for that key).

### 8.3 Segment compliance and EA interpretation

For a non-rigid segment, compliance is set as:

$$
\alpha_{\text{seg}} = \texttt{XPBD\_COMPLIANCE\_SCALE} \cdot \frac{L}{EA}
$$

where $L$ is the segment rest length and $EA$ the effective axial rigidity from the stick’s stiffness UI mapping (`getEffectiveStickAxialRigidityFromPercent` with `HYBRID_SOLVER` parameters).

**Rigid** sticks (stiffness at or above the rigid cutoff) use $\alpha_{\text{seg}} = 0$, giving stiff distance corrections without accumulating a persistent segment $\lambda$.

### 8.4 Bending and straightness

**Bending** triples $(A,M,B)$ introduce an auxiliary **outer distance** target: keep $\|\mathbf{x}_B - \mathbf{x}_A\|$ near a stored rest value (initialized from the first solved geometry, then tracked in `bendingRestState`). Compliance is

$$
\alpha_{\text{bend}} = \frac{1}{k_{\text{bend}}}
$$

with $k_{\text{bend}} =$ `BENDING_STIFFNESS`.

After projection, **bending damping** lerps the middle node’s velocity toward the average of the outer velocities:

$$
\mathbf{v}_M \leftarrow (1 - e^{-\beta_b \Delta t})\,\frac{\mathbf{v}_A + \mathbf{v}_B}{2} + e^{-\beta_b \Delta t}\,\mathbf{v}_M
$$

with $\beta_b =$ `BENDING_DAMPING`.

**Straightness** triples along split interiors use the same distance primitive but with **zero compliance**, favoring locally straight subdivisions inside a single user stick.

## 9. Velocity Update

After all substeps, for each non-kinematic node:

$$
\mathbf{v}_i \leftarrow \frac{\mathbf{x}_i - \mathbf{x}_i^{\text{prev}}}{\Delta t}
$$

where $\mathbf{x}_i^{\text{prev}}$ was stored at the beginning of the integration substep.

## 10. Commit Phase and Diagnostics

`applySolvedState` writes segment endpoint positions back into each `Stick`, and computes aggregate **strain** and average **tension** proxy from persistent segment $\lambda$ keys.

`commitSolvedState` caches:

- `lastSolvedNodePositions` and `dynamicNodeState` (positions + velocities) for warm starts,
- `dynamicDiscState` for soft discs,
- `lastSolvedDiscAngles` for all rotating bodies,
- prunes stale entries from `constraintLambdaState` when segments disappear.

Diagnostic metrics approximate:

$$
\text{constraintNorm} = \sqrt{\sum_s (\Delta L_s)^2}, \quad
E \approx \sum_s \tfrac{1}{2} k_{s} \, (\Delta L_s)^2
$$

with $k_s \approx EA / L$ and $\Delta L_s$ the stretch per segment (see `computeMetrics`).

## 11. Playback Resolution Pipeline (Hybrid)

In [src/app.js], when `solverMode === 'hybrid'`:

1. `advanceDiscAngles` calls `updateDriveTarget` on every rotating body (RPM ramp + `driveTargetAngle`). Hard-driven bodies also set `angle = driveTargetAngle` there; soft bodies leave `angle` for the hybrid integrator.
2. `system.syncAttachedRotatingBodies()` and slider sync run.
3. `HybridSolver.solve({ dtMs, timeScale })` performs substeps as described.
4. On success, pencils and traces update from the new geometry.

Thus **soft discs** feel RPM changes through their target angle signal while their **actual** angles lag inside the hybrid integrator.

## 12. Parameter Reference (`HYBRID_SOLVER`)

Defaults are defined in [src/config.js] (spread-including `POSITION_SOLVER_PARAMETERS` for stick stiffness cutoffs used by the mapping helpers). Representative keys:

| Symbol / key | Role |
| --- | --- |
| `MAX_ITERATIONS` | Inner constraint sweeps per substep. |
| `SUBSTEPS` | Physics substeps when `dtMs ≠ 0`. |
| `SEGMENT_DENSITY` | $\rho$ in the linear mass model. |
| `GLOBAL_DAMPING` | $\gamma$ for exponential velocity damping before integration. |
| `XPBD_COMPLIANCE_SCALE` | Global scalar on segment compliance $\alpha_{\text{seg}}$. |
| `BENDING_STIFFNESS` / `BENDING_DAMPING` | Resists curvature + mid-node velocity smoothing. |
| `SOFT_DRIVE_STIFFNESS` / `DRIVE_ANGULAR_DAMPING` | Soft disc angle tracking behavior. |
| `SOFT_ATTACHMENT_COMPLIANCE` | Base compliance for finite-torque disc/screen starts, scaled by torque ratio. |
| `ANCHOR_EXTRA_PASSES` | After each full sweep inside an outer iteration, repeat only `hardAnchorConstraints` this many extra times (`0` = off). |

Exact numeric values should always be read from the config object in source; they may be tuned without updating this document.

## 13. What This Model Captures Well

- **Robust editing**: `dtMs = 0` solves give a quick feasible configuration while dragging attachments.
- **Visual compliance**: stretchy sticks, soft starts, and bending controls without a large sparse Newton solve each frame.
- **Soft actuator feel**: finite-torque discs lag their kinematic targets instead of snapping every frame.
- **Mid-stick topology**: virtual nodes keep constraints local and symmetric.

## 14. Current Limitations and Non-Goals

### 14.1 Not a verified engineering integrator

The XPBD loop is adapted for interactives; it does **not** guarantee energy conservation or timestep-independent accuracy in the analytical ODE sense.

### 14.2 Gauss–Seidel bias

Constraint ordering and per-iteration sweeps introduce **asymmetry**; changing iteration counts can slightly change resting shapes under high compliance.

### 14.3 Simplified soft disc physics

`advanceSoftDiscs` does not solve coupled motor–network torque balance; it is a **tracking filter** on angle.

### 14.4 No contact / friction model

Self-intersection and contact are outside the hybrid formulation.

### 14.5 Parameter coupling

Many visually coupled effects (damping, substeps, compliance, iterations) must be tuned jointly; there is no single “physical unit” guarantee across the UI percentages and XPBD parameters.

## 15. Mental Model for Contributors

When modifying this branch, think in terms of:

- **Particles** at chain joints and split points,
- **Distance constraints** as rubber bands with optional softness,
- **Pins** that overwrite particles (kinematic attachments and sliders),
- **XPBD multipliers** remembering how hard compliant constraints were pushing last iteration,
- **Substeps** trading accuracy for stability when playback `dt` wobbles.

In short:

> **Predict (optional) with damped inertia → project constraints locally many times → infer velocities.**

## 16. Suggested Future Extensions

- Analytic gradients for selected constraints to accelerate convergence or reduce iteration count sensitivity.
- Separate UI knobs for **physical density** versus **visual compliance** to reduce tuning coupling.
- Impulse-based collisions for sticks and screen boundaries.
- Optional implicit integration for stiff regimes where explicit velocity damping is insufficient.
- Richer debug overlays: per-constraint $\lambda$ heatmaps, substep energy traces, topology graphs.
