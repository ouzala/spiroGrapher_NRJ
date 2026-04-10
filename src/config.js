//  APP CONFIGURATION FILE

const SHARED_SOLVER_PARAMETERS = {
    CONVERGENCE_TOLERANCE: 1e-3,
    JACOBIAN_EPSILON: 1e-4,
    FIXED_STEP_MS: 1000 / 60,
};

const SYSTEM_DEFAULTS = {
    DISC_DEF_RPM: 45,           // default disc rpm
    SCREEN_DEF_RPM: 0,          // default screen rpm
    DISC_DEF_TORQUE: 100,       // default value, % Based
    STICK_STIFFNESS: 100,       // default value, % Based
    PENCIL_DEF_RADIUS: 4,       // px symbole radius
    TRACE_DEF_WIDTH: 1.5,       // px trace line width   
    TRACE_DEF_DURATION: 20,     // persistance in seconds
    ZOOM : 1,                   // Starting zoom level
    VIEW_CENTER: {x:0, y:0},    // Canvas centering
    DISC_ALPHA : 0.8,           // Default disc rgbA transparency
    RPM_MAX: 200,               // RPM range 
};

const POSITION_SOLVER_PARAMETERS = {
    MAX_COORDINATE_STEP: 40,
    STICK_RIGID_STIFFNESS_PERCENT: 100,
    STICK_RIGID_STIFFNESS: 1e6,
    STICK_MAX_COMPLIANT_STIFFNESS: 1e4,
    STICK_MIN_STIFFNESS: 1e-6
};

const DEFAULT_COLORS = {
            background: '#2f2f2f',
            gridColor: '#4b4b4b',
            
            discFill: '#9bbbd1',
            discStroke: '#2980b9',
            discCenter: '#103a5c',
            discRotationIndicator: '#ffffff',
            
            stickStroke: '#e74c3c',
            stickWidth: 3,
            jointRadius: 4,
            jointFill: '#ff4d4f',
            
            anchorFill: '#f1c40f',
            anchorStroke: '#b87e00',
            
            pencilDefaultColor: '#1de6e6',
            
            screenDefaultFill: '#1d1d1d',
            screenStroke: '#626262',
            screenCenter: '#3f3f3f',        
};

const VALIDATOR_DEFAULTS = {
    MAX_ACTUATORS : 10,
    MAX_CHAINS : 10,
    MAX_SCREENS : 10,
    MAX_ANCHORS : 10,
}

const TESTING_LANDSCAPE = {
    // TODO : extend loader @ app.testLandscapeLoader()

    // Discs and Screens Only loader
    "discs" : [ {x:700, y:700, r:80, rpm:30} , {x:-700, y:-700, r:80, rpm:55}],  
    "screens" : [{x:0, y:0, r:200, rpm:5}] ,
}

window.AppConfig = {
    SYSTEM_DEFAULTS,
    clampStickStiffnessPercent,
    transformStickStiffnessPercent,
    getEffectiveStickStiffnessFromPercent,
    getEffectiveStickAxialRigidityFromPercent,

    GENERAL_SIMULATION : {...SHARED_SOLVER_PARAMETERS },

    COLORS : {...DEFAULT_COLORS },

    VALIDATORS : {...VALIDATOR_DEFAULTS},

    KINEMATIC_SOLVER : {
        MAX_ITERATIONS: 30,
        DAMPING: 1e-3,
        MAX_ANGLE_STEP: 0.35
    },

    ENERGY_SOLVER : {
        ...POSITION_SOLVER_PARAMETERS,
        MAX_ITERATIONS: 40,
        DAMPING: 1e-2,
        ANCHOR_STIFFNESS: 1e5,
        FIXED_POINT_STIFFNESS: 1e5
    },

    HYBRID_SOLVER : {
        ...POSITION_SOLVER_PARAMETERS,
        MAX_ITERATIONS: 18,
        DAMPING: 1e-2,
        MAX_DISC_ANGLE_STEP: 0.4,
        MERIT_CONSTRAINT_WEIGHT: 50,
        DRIVE_WEIGHT: 5e-2,
        FREEWHEEL_REGULARIZATION: 1e-4,
        SEGMENT_DENSITY: 2.5e-2,
        GLOBAL_DAMPING: 14,
        BENDING_STIFFNESS: 6e1,
        BENDING_DAMPING: 5,
        XPBD_COMPLIANCE_SCALE: 1,
        SUBSTEPS: 6,
        SOFT_DRIVE_STIFFNESS: 18,
        DRIVE_ANGULAR_DAMPING: 10,
        SOFT_ATTACHMENT_COMPLIANCE: 4e-4
    },

    TEST_LANDSCAPE : {...TESTING_LANDSCAPE},

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

function getEffectiveStickAxialRigidityFromPercent(percent, parameters) {
    return getEffectiveStickStiffnessFromPercent(percent, parameters);
}
