window.AppConfig = window.AppConfig || {

    // Simulation General Parameters (Both solvers)

    // EnergySolver.js :
    // ... Segment stiffness values
    STICK_RIGID_STIFFNESS_CUTOFF: 999,
    STICK_RIGID_STIFFNESS: 1e6,
    STICK_MIN_STIFFNESS: 1e-6,

    // Solver defaults
    ANCHOR_STIFFNESS: 1e5,
    FIXED_POINT_STIFFNESS: 1e5,
    SOLVER_MAX_ITERATIONS: 40,
    SOLVER_CONVERGENCE_TOLERANCE: 1e-3,
    SOLVER_JACOBIAN_EPSILON: 1e-4,
    SOLVER_DAMPING: 1e-2,
    SOLVER_MAX_COORDINATE_STEP: 40,

    // HybridSolver.js
    HYBRID_MERIT_CONSTRAINT_WEIGHT: 50,
    HYBRID_DRIVE_WEIGHT: 5e-2,
    HYBRID_FREEWHEEL_REGULARIZATION: 1e-4,
    HYBRID_DISC_ANGLE_STEP: 0.4
};
