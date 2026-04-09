# EnergySolver Model Summary

This document summarizes the energy-based solver branch centered on [src/engine/EnergySolver.js]. It describes how the mechanism is represented, which parts of the system are treated as hard versus soft constraints, and how each animation step resolves the mechanism configuration.

### ENERGY REFORMULATION OF THE SPYROGRAPHER KINEMATIC MODEL
--> Segments get a spring stiffness component
--> Anchors and fixed points are part of the energy formulation (soft constraint) but with high weights => "practicaly fix"

## 0. Purpose

The energy model replaces the former angle-based kinematic closure logic in KinematicSolver.js with a position-based least-squares solve.

Instead of solving directly for stick angles, the solver treats the unknown mechanism state as the Cartesian positions of chain nodes:

- each stick chain contributes one node at its start attachment,
- one node at every inter-stick joint,
- and one node at the chain end.

The active configuration is the position vector that minimizes a weighted residual energy:

$$
E(x) = \frac{1}{2} \|r(x)\|^2
$$

where:

- $x$ is the stacked vector of unknown node coordinates,
- $r(x)$ is the residual vector built from segment stretch errors and positional attachment penalties.

This is not a full rigid-body dynamics model. It is a quasi-static equilibrium solve performed at every playback step after disc angles are advanced.


## 1. Overview

The system is modeled as a set of points $( X_{i,k}(t) \in \mathbb{R}^2 )$ connected by elastic elements (springs) and subject to attachment constraints.

Instead of enforcing hard geometric constraints, the configuration at time ( t ) is obtained by minimizing a total energy:

$$
E_{\text{total}}(x,t)
$$

where $( x )$ is the vector of all unknown node positions.

---

### 1.1. Variables

* Nodes:
  $$
  X_{i,k}(t) \in \mathbb{R}^2
  $$

* Disc-driven attachment points:
  $$
  A_i(t) = c_i + r_i
  \begin{pmatrix}
  \cos(\theta_i(t)) \
  \sin(\theta_i(t))
  \end{pmatrix}
  $$

---

### 1.3. Segment (Spring) Energy

Each segment behaves like a linear spring with:

* rest length ( s_{i,k} )
* stiffness ( k_{i,k} > 0 )

Energy contribution:

$$
E_{i,k} = \frac{1}{2} k_{i,k} \left( |X_{i,k} - X_{i,k-1}| - s_{i,k} \right)^2
$$

---

### 1.4. Anchor Energy

An anchor connects a node ( X_{i,n_i} ) to a point on another segment.

Let:
$$
H(t) = X_{j,\ell-1}(t) + \lambda \left( X_{j,\ell}(t) - X_{j,\ell-1}(t) \right), \quad \lambda \in [0,1]
$$

Anchor energy:

$$
E_{\text{anchor}} = \frac{1}{2} k_a , |X_{i,n_i} - H(t)|^2
$$

where $( k_a )$ is the anchor stiffness.

---

### 1.5. Disc Attachment Energy (Optional)

If disc attachment is treated as a soft constraint:

$$
E_{\text{disc}} = \frac{1}{2} k_d , |X_{i,0} - A_i(t)|^2
$$

Otherwise, enforce:
$$
X_{i,0}(t) = A_i(t)
$$
as a hard constraint.

---

### 1.6. Total Energy

$$
E_{\text{total}}(x,t) =
\sum_{i,k} E_{i,k}
+
\sum_{\text{anchors}} E_{\text{anchor}}
+
\sum_i E_{\text{disc}}
$$

---

### 1.7. System Solution

At each time $( t )$, the configuration is obtained by solving:

$$
x^*(t) = \arg\min_x E_{\text{total}}(x,t)
$$

---

### 1.8. Dynamic Extension (Optional)

If masses ( m ) are introduced, the system evolves according to:

$$
m \ddot{x}(t) = - \nabla E_{\text{total}}(x,t)
$$

With damping:

$$
m \ddot{x}(t) + c \dot{x}(t) + \nabla E_{\text{total}}(x,t) = 0
$$

---

### 1.9. Notes

* As $( k_{i,k} \to \infty )$, segments behave as rigid constraints.
* Large $( k_a )$ enforces strong anchoring.
* The formulation guarantees existence of a solution (minimum energy), but not necessarily uniqueness.
* Numerical optimization methods (e.g. L-BFGS, Gauss-Newton) are typically used.

##2. High-Level Architecture

The model is distributed across a few core files:

- [src/engine/EnergySolver.js]: builds the topology, computes residuals, approximates the Jacobian, and runs the damped least-squares solve.
- [src/models/System.js]: owns discs, stick chains, anchors, pencils, validation, and disc-drive interpretation.
- [src/models/Disc.js]: defines the rotating actuator geometry and whether the disc is hard-driven or torque-limited.
- [src/models/Stick.js]: stores rest length, stiffness, and solved endpoints.
- [src/models/StickChain.js]: organizes sticks into ordered chains with start and end attachments.
- [src/models/Anchor.js]: represents manual point-to-point positional couplings.
- [src/config.js]: provides solver constants and stiffness defaults.
- [src/app.js]: advances disc angles and invokes `solver.solve()` once per simulation step.

## 3. State Representation

### 3.1 Physical entities

The mechanism is built from:

- discs: moving reference attachments driven by RPM,
- stick chains: ordered segments with nominal length and stiffness,
- anchors: positional couplings between a point on one stick and another target,
- pencils: passive observers sampled from stick geometry after each solve.

### 3.2 Solver unknowns

`EnergySolver` does not use angles as optimization variables. It creates one node per chain endpoint/joint and solves for:

$$
x = [x_1, y_1, x_2, y_2, \dots]^T
$$

Only non-fixed nodes are included in $x$.

### 3.3 Fixed versus variable nodes

During topology construction, a chain start node is marked fixed only when:

- the chain starts from a disc attachment, and
- that disc is `hard-driven`, meaning `disc.torque` is not finite.

In the current branch:

- hard-driven disc start nodes are exact prescribed positions,
- finite-torque disc start nodes are not fixed; they are soft positional attachments,
- chain end attachments to anchors or fixed points are soft penalties, not exact constraints,
- manual anchors are also soft penalties.

This means the EnergySolver branch is a soft-constraint equilibrium model with only one truly hard geometric condition: hard-driven disc start positions.

## 4. Attachment Semantics

Attachment interpretation comes from [src/models/System.js](/c:/Users/mitad/CODE_DEV/OUZALA/spiroGrapher_NRJ/src/models/System.js).

Supported effective attachment types are:

- `disc`: point on a rotating disc, evaluated by `Disc.getPointOnSurface(distance, angleOffset)`.
- `anchor`: point on an existing stick, encoded in stored data as `type: 'stick'` but normalized by `System.getAttachmentType`.
- `fixedPoint`: explicit ${ x, y }$ world-space point.
- `openEnd`: unconstrained chain end.

`EnergySolver.getAttachmentPosition()` resolves these target points on demand from the current solved geometry and current disc angles.

## 5. Topology Construction

At the start of every solve, `buildTopology()` creates a temporary optimization graph containing:

- `nodes`: all chain nodes,
- `variableNodes`: the subset included in the unknown vector,
- `variableIndexByNodeKey`: lookup from logical node key to optimization index,
- `chainNodes`: chain-to-node mapping,
- `segments`: stick-to-node adjacency records,
- `softDiscAttachments`: start-node penalties for finite-torque discs,
- `chainEndConstraints`: end-node penalties for anchor/fixed-point targets,
- `manualAnchors`: separately declared anchor penalties.

For a chain with `N` sticks:

- it contributes `N + 1` nodes,
- and `N` segment records.

Each segment references:

- the underlying `Stick`,
- its start node,
- its end node.

This topology is ephemeral. It is rebuilt every time `solve()` runs so it always reflects current system edits.

## 6. Initialization and Warm Start

The initial guess for each variable node is chosen in this order:

1. the cached node position from `lastSolvedNodePositions`,
2. the current rendered node position from existing stick geometry,
3. a fallback forward construction from chain attachments and stored stick angles.

This warm-start behavior is important because the system is solved every frame. Reusing the previous frame’s node positions greatly reduces iteration count and helps continuity.

## 7. Energy Terms and Residual Model

The solver minimizes the squared norm of residuals rather than assembling energy terms symbolically. Each residual contributes:

$$
E_i = \frac{1}{2} r_i^2
$$

so the total energy is:

$$
E(x) = \frac{1}{2} \sum_i r_i(x)^2
$$

### 7.1 Segment stretch residuals

For every stick segment:

$$
r_{\text{segment}} = \sqrt{k_{\text{eff}}}\left(\|X_b - X_a\| - L\right)
$$

where:

- `X_a`, `X_b` are the endpoint nodes,
- `L` is the stick rest length (`stick.restLength`),
- `k_eff` is the effective segment stiffness.

`k_eff` comes from `getEffectiveStickStiffness()`:

- if `stick.stiffness >= STICK_RIGID_STIFFNESS_CUTOFF`, the solver uses `STICK_RIGID_STIFFNESS`,
- otherwise it uses `max(STICK_MIN_STIFFNESS, stick.stiffness)`.

So “rigid” sticks are still solved as very stiff springs, not exact inextensible bars.

### 7.2 Soft disc attachment residuals

If a chain starts on a finite-torque disc, its start node is pulled toward the disc attachment point with two Cartesian residuals:

$$
r_x = \sqrt{k_d}(x - x_d), \quad r_y = \sqrt{k_d}(y - y_d)
$$

with:

- target position from the current disc angle,
- stiffness $ k_d = max(1e-3, disc.torque) $.

This uses the `torque` field as a positional penalty weight, not as a real torque in a dynamic rotational equation.

### 7.3 Chain end attachment residuals

If a chain end attaches to an anchor point on another stick or to a fixed point, the final node gets two positional residuals:

$$
r_x = \sqrt{k_c}(x - x_t), \quad r_y = \sqrt{k_c}(y - y_t)
$$

where `k_c` is:

- `FIXED_POINT_STIFFNESS` for fixed endpoints,
- `ANCHOR_STIFFNESS` for stick-anchor endpoints.

### 7.4 Manual anchor residuals

A manual anchor constrains a point on a primary stick to another target. The primary point is recomputed from the current solved stick endpoints, then compared to its target with two residuals:

$$
r_x = \sqrt{k_a}(x_p - x_t), \quad r_y = \sqrt{k_a}(y_p - y_t)
$$

where `k_a = ANCHOR_STIFFNESS`.

Because the primary point is interpolated along a stick, manual anchors indirectly couple multiple node coordinates.

## 8. Numerical Resolution Process

The solve loop in [src/engine/EnergySolver.js](/c:/Users/mitad/CODE_DEV/OUZALA/spiroGrapher_NRJ/src/engine/EnergySolver.js) follows a damped Gauss-Newton / Levenberg-style least-squares pattern.

### 8.1 Entry checks

`solve()` first aborts if:

- `ml-matrix` is unavailable,
- `System.validate()` fails,
- there are no variable nodes and no segments to solve.

### 8.2 Iteration loop

For up to `SOLVER_MAX_ITERATIONS` iterations:

1. apply the current node vector to topology nodes and update stick endpoints,
2. compute residual vector $r(x)$,
3. compute residual norm $||r||$,
4. stop early if the norm is below `SOLVER_CONVERGENCE_TOLERANCE`,
5. approximate the Jacobian with finite differences,
6. solve a damped least-squares step,
7. clamp each coordinate update,
8. run a short backtracking line search,
9. accept the first step that decreases the residual norm.

### 8.3 Jacobian approximation

The Jacobian is built numerically, column by column:

$$
J_{:,j} \approx \frac{r(x + \varepsilon e_j) - r(x)}{\varepsilon}
$$

using `SOLVER_JACOBIAN_EPSILON`.

This is simple and robust for the current codebase, but more expensive than an analytic Jacobian.

### 8.4 Damped least-squares step

The solver computes `delta` from an augmented system:

$$
\begin{bmatrix}
J \\
\sqrt{\lambda} I
\end{bmatrix}
\Delta x =
\begin{bmatrix}
-r \\
0
\end{bmatrix}
$$

where `lambda = SOLVER_DAMPING`.

Implementation details:

- it first tries a QR solve (`QrDecomposition`) when full rank,
- it falls back to an SVD-based solve via `mlMatrix.solve(..., true)` if needed.

### 8.5 Step limiting

Each coordinate update is clamped independently to:

$$
\Delta x_j \in [-\text{SOLVER\_MAX\_COORDINATE\_STEP}, \text{SOLVER\_MAX\_COORDINATE\_STEP}]
$$

This prevents large unstable jumps.

### 8.6 Backtracking acceptance

The proposed step is tested at scales:

- `1`
- `0.5`
- `0.25`
- `0.1`

The first scale that strictly reduces the residual norm is accepted. If none work, the solver restores the last committed solution and returns failure.

## 9. Commit, Restore, and Output

On success:

- node coordinates are committed,
- `lastSolvedNodePositions` is updated,
- pencil positions are refreshed,
- a result object is returned with `success`, `residualNorm`, `iterationCount`, `energy`, `warnings`, and a topology summary.

On recoverable failure:

- the solver restores previously committed node positions when possible,
- pencil positions are updated from the restored geometry,
- a failure result with warnings is returned.

The reported scalar energy is:

$$
E = \frac{1}{2} \sum_i r_i^2
$$

which is consistent with the least-squares formulation used internally.

## 10. Playback Resolution Pipeline

The runtime flow is orchestrated in [src/app.js](/c:/Users/mitad/CODE_DEV/OUZALA/spiroGrapher_NRJ/src/app.js):

1. playback advances disc angles from RPM,
2. `solver.solve()` is called,
3. solved node positions are written back into stick endpoints,
4. pencil points are sampled from the solved stick geometry,
5. traces are recorded.

Important implication:

- disc motion is prescribed first,
- then the mechanism is relaxed into a best-fit equilibrium for that instant.

There is no inertial state for stick nodes, no velocity solve, and no force integration across time.

## 11. Parameter Meanings

Current defaults from [src/config.js](/c:/Users/mitad/CODE_DEV/OUZALA/spiroGrapher_NRJ/src/config.js):

- `STICK_RIGID_STIFFNESS_CUTOFF = 999`
- `STICK_RIGID_STIFFNESS = 1e6`
- `STICK_MIN_STIFFNESS = 1e-6`
- `ANCHOR_STIFFNESS = 1e5`
- `FIXED_POINT_STIFFNESS = 1e5`
- `SOLVER_MAX_ITERATIONS = 40`
- `SOLVER_CONVERGENCE_TOLERANCE = 1e-3`
- `SOLVER_JACOBIAN_EPSILON = 1e-4`
- `SOLVER_DAMPING = 1e-2`
- `SOLVER_MAX_COORDINATE_STEP = 40`

Interpretation:

- larger stiffness values increase enforcement strength,
- larger damping improves robustness but can slow convergence,
- smaller tolerance demands a tighter equilibrium,
- larger max step allows faster movement but can destabilize difficult solves.

## 12. What This Model Captures Well

The current branch is well suited for:

- mechanisms that benefit from approximate closure instead of brittle exact closure,
- mixing near-rigid segments with visibly compliant segments,
- smooth continuation from one frame to the next via warm starting,
- representing finite-torque disc attachments as soft positional coupling,
- editing-time robustness when topology changes frequently.

## 13. Current Limitations and Non-Goals

The current EnergySolver implementation deliberately stops short of a full physical simulation.

### 13.1 No true rigid constraints except hard-driven starts

Most constraints are penalties, not exact constraints. Even “rigid” sticks are just very stiff springs.

### 13.2 No dynamic torque response

Finite disc torque does not produce angular acceleration or reaction torque. The disc still follows prescribed RPM; `torque` only scales how strongly the chain start is pulled toward the disc attachment.

This limitation is also surfaced by `System.analyzeDiscDrives()`.

### 13.3 No masses, velocities, or damping in time

The solver computes an equilibrium per frame. It does not integrate:

- node mass,
- linear momentum,
- damping forces,
- impact/contact dynamics.

### 13.4 Soft closures can drift

If stiffness values are too low, closed loops may visibly stretch or detach because closure is approximate.

### 13.5 Numerical cost

The Jacobian is finite-differenced, so solve cost increases with the number of variable coordinates.

# 14. Mental Model for Contributors

When working on this branch, it helps to think of the system like this:

- discs provide moving target points,
- stick chains provide node graphs,
- each stick tries to preserve its rest length,
- anchors and endpoints pull selected points toward targets,
- the solver searches for the node configuration with minimum weighted mismatch.

In short:

- geometry is expressed in positions,
- rigidity is approximated through high stiffness,
- and each frame is solved as a nonlinear least-squares equilibrium problem.

# 15. Suggested Future Extensions

Natural next steps for this branch would be:

- introduce analytic Jacobians for performance,
- separate “soft attachment stiffness” from physical torque semantics,
- support exact constraints with Lagrange multipliers or projected solves,
- add node masses and time integration for real dynamics,
- expose topology and residual breakdown in debug tooling,
- report per-term energy contributions for tuning and diagnosis.
