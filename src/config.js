const SHARED_SOLVER_PARAMETERS = {
    CONVERGENCE_TOLERANCE: 1e-3,
    JACOBIAN_EPSILON: 1e-4,
    FIXED_STEP_MS: 1000 / 60,
};

const SYSTEM_DEFAULTS = {
    DISC_TORQUE: 100,
    STICK_STIFFNESS: 100
};

const POSITION_SOLVER_PARAMETERS = {
    MAX_COORDINATE_STEP: 40,
    STICK_RIGID_STIFFNESS_PERCENT: 100,
    STICK_RIGID_STIFFNESS: 1e6,
    STICK_MAX_COMPLIANT_STIFFNESS: 1e4,
    STICK_MIN_STIFFNESS: 1e-6
};

const DEFAULT_COLORS = {
            background: '#282828',
            gridColor: '#333',
            
            discFill: '#3498db',
            discStroke: '#2980b9',
            discCenter: '#103a5c',
            
            stickStroke: '#e74c3c',
            stickWidth: 3,
            jointRadius: 4,
            jointFill: '#ff4d4f',
            
            anchorFill: '#f1c40f',
            anchorStroke: '#c89d08',
            
            pencilDefaultColor: '#6dd3c7',
            pencilRadius: 4,

            screenDefaultFill: '#080808',
            screenStroke: '#080808',
            screenCenter: '#080808',        
};

window.AppConfig = {
    SYSTEM_DEFAULTS,
    clampStickStiffnessPercent,
    transformStickStiffnessPercent,
    getEffectiveStickStiffnessFromPercent,

    GENERAL_SIMULATION: {...SHARED_SOLVER_PARAMETERS },

    COLORS: {...DEFAULT_COLORS },

    KINEMATIC_SOLVER: {
        MAX_ITERATIONS: 30,
        DAMPING: 1e-3,
        MAX_ANGLE_STEP: 0.35
    },

    ENERGY_SOLVER: {
        ...POSITION_SOLVER_PARAMETERS,
        MAX_ITERATIONS: 40,
        DAMPING: 1e-2,
        ANCHOR_STIFFNESS: 1e5,
        FIXED_POINT_STIFFNESS: 1e5
    },

    HYBRID_SOLVER: {
        ...POSITION_SOLVER_PARAMETERS,
        MAX_ITERATIONS: 40,
        DAMPING: 1e-2,
        MAX_DISC_ANGLE_STEP: 0.4,
        MERIT_CONSTRAINT_WEIGHT: 50,
        DRIVE_WEIGHT: 5e-2,
        FREEWHEEL_REGULARIZATION: 1e-4
    }
};

// Helper functions for stick stiffness calibration and transformation. The UI allows users to specify stick stiffness as a percentage, which is then transformed into an effective stiffness value used by the solvers. The transformation is designed to provide a smooth and intuitive mapping from percentage to stiffness, with special handling for values at the upper end of the range to allow for a "rigid" setting.

function clampStickStiffnessPercent(value) {
    return MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 100);
}

function transformStickStiffnessPercent(percent) {
    const normalized = clampStickStiffnessPercent(percent) / 100;
    return normalized;
}

function getEffectiveStickStiffnessFromPercent(percent, parameters) {
    const clampedPercent = clampStickStiffnessPercent(percent);
    if (clampedPercent >= parameters.STICK_RIGID_STIFFNESS_PERCENT) {
        return parameters.STICK_RIGID_STIFFNESS;
    }

    const transformed = MathUtils.clamp(transformStickStiffnessPercent(clampedPercent), 0, 1);
    if (transformed <= 0) {
        return parameters.STICK_MIN_STIFFNESS;
    }

    const minStiffness = parameters.STICK_MIN_STIFFNESS;
    const maxCompliantStiffness = parameters.STICK_MAX_COMPLIANT_STIFFNESS;
    return minStiffness * Math.pow(maxCompliantStiffness / minStiffness, transformed);
}
