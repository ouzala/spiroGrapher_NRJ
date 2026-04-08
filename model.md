# Mathematical Model

## Scope

This document defines the intended kinematic model for the coupled oscillators project.
It is the reference for data structures, validation rules, and numerical solving.

The current implementation is browser-side and planar.
All positions are in world coordinates on a 2D plane.

## Entities

### Disc

A disc `D_i` is defined by:

- center `C_i = (x_i, y_i)`
- radius `R_i`
- angle `phi_i(t)`
- angular speed `omega_i(t)`

A point attached to a disc is described by:

- radial offset `r`
- angular offset `alpha`

Its world position is:

`P_disc = C_i + r * [cos(phi_i + alpha), sin(phi_i + alpha)]`

Disc angles are prescribed inputs during playback.
They are not solved unknowns.

### Stick

A stick `S_j` is a rigid link with:

- fixed length `L_j`
- orientation `theta_j`
- start point `A_j`
- end point `B_j`

The stick geometry is:

`B_j = A_j + L_j * [cos(theta_j), sin(theta_j)]`

Important rule:

- stick length is immutable unless the user explicitly edits it

### Stick Chain

A chain is an ordered list of sticks.
For chain `k` with sticks `S_k0, S_k1, ..., S_k(m-1)`:

- the start of the first stick is attached to a prescribed start attachment
- each consecutive stick starts at the end of the previous stick
- the last stick may have either an open end or a hard end coupling

Internal chain joints are implicit revolute joints.
They do not introduce separate residual equations because the chain parameterization already enforces them.

### Pencil

A pencil attached to stick `S_j` at curvilinear coordinate `s` has world position:

`P_pencil = A_j + s * [cos(theta_j), sin(theta_j)]`

with `0 <= s <= L_j`.

## Attachment Types

### Start Attachment

The current start attachment is a disc attachment.
It is a prescribed moving point.

### End Attachment Types

#### `openEnd`

An unconstrained chain terminal node.

- no residual equation is generated
- playback should be blocked if the full system remains underconstrained
- this is valid as an edit/build state

#### `anchor`

A hard coupling to a point on another stick.
It is a shared articulation between the chain end node and the host stick.

If the target point on the other stick is `Q`, then for the last stick end `B_last`:

`B_last - Q = 0`

This yields 2 scalar residual equations.

Important articulation rule:

- the coupling constrains only position
- it does not constrain relative angle
- both connected segments remain free to rotate about the shared point
- editor-created manual anchors use this same articulation rule, but the constrained point may be any point along a primary stick, not only a chain endpoint
- when a manual anchor is created, the primary stick is the first stick found at the clicked locus
- the target is resolved at creation time from other elements already present at that same locus: another stick first, otherwise a disc point, otherwise a `fixedPoint`
- manual anchors are visualized as yellow dots; endpoint anchors should use the same yellow marker

#### `fixedPoint`

A hard coupling to a fixed world point `Q_fixed`.

`B_last - Q_fixed = 0`

This also yields 2 scalar residual equations.

Note:

- `fixedPoint` is part of the model even if the editor does not yet expose it as a user tool

## Degrees of Freedom

During playback:

- disc angles are known inputs
- stick angles are the solver unknowns

If the system has `N` sticks, the current unknown vector is:

`x = [theta_1, theta_2, ..., theta_N]`

So the total number of scalar unknowns is:

`n_unknown = N`

Each hard end coupling contributes 2 scalar constraints.

Current first-pass sufficiency rule:

- if `2 * (# hard couplings) < (# stick angles)`, the system is considered underconstrained for playback

This rule is only a structural sufficiency check.
It is not a full guarantee of consistency or uniqueness.

## Constraint Residual Vector

The solver residual vector is built only from hard couplings.

For each hard-coupled chain end:

- compute target point `Q`
- compute last stick end `B_last`
- append residuals:

`r_x = Q_x - B_last_x`

`r_y = Q_y - B_last_y`

The full nonlinear system is:

`r(x) = 0`

where `x` is the vector of stick angles.

Important modeling rule:

- `openEnd` must not contribute any residual term

## Forward Kinematics

Given all disc angles and stick angles:

1. compute each chain start point from its start attachment
2. propagate each stick in chain order using its fixed length and angle
3. compute pencils from their host stick geometry

This gives a deterministic world pose for every visible element.

## Resolution Process

### Builder / Edit Mode

The editor may contain:

- open chains
- partially constrained chains
- configurations that are not yet playable

This is allowed.
Builder mode is for construction, not for enforcing dynamic solvability at every intermediate step.

### Playback Mode

Before entering playback:

1. validate references and topology
2. count unknowns and hard constraints
3. reject obviously underconstrained systems

If the system is structurally underconstrained, playback must show:

`Constraints insufficient, add elements to close the system.`

### Numerical Solve

For a sufficiently constrained system:

1. advance disc angles
2. warm-start the stick angles from the previous frame
3. evaluate residual vector `r(x)`
4. solve a damped nonlinear least-squares step
5. update stick angles
6. compute pencil positions and traces

## Numerical Strategy Recommendation

The intended solver family is:

- Gauss-Newton or Levenberg-Marquardt
- with a rectangular Jacobian
- solved in least-squares form using QR or SVD
- with warm starts from the previous frame
- implemented in-browser with `ml-matrix` for linear algebra

Why:

- the system is nonlinear
- the Jacobian is generally rectangular
- coupled chains can be overdetermined or near-singular
- temporal coherence should improve convergence strongly

Current implementation direction:

- build the nonlinear kinematic residuals in project code
- use `ml-matrix` QR decomposition first for damped least-squares steps
- fall back to `ml-matrix` SVD-based solve when QR is rank-deficient

## Current Refactor Direction

The refactor should proceed in this order:

1. make endpoint semantics explicit: `openEnd`, `anchor`, `fixedPoint`
2. ensure stick lengths remain immutable
3. block playback for underconstrained systems
4. rebuild residual assembly to ignore open ends
5. replace the current square-only linear solve with proper least-squares numerics
6. add better consistency and uniqueness checks after the new solver is in place
