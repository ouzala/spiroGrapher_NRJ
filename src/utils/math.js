/**
 * Math utilities for kinematic calculations
 */
const MathUtils = {
    /**
     * Calculate distance between two points
     * @param {number} x1, y1, x2, y2
     * @returns {number}
     */
    distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Calculate angle from point1 to point2
     * @param {number} x1, y1, x2, y2
     * @returns {number} angle in radians
     */
    angleToPoint(x1, y1, x2, y2) {
        return Math.atan2(y2 - y1, x2 - x1);
    },

    /**
     * Normalize angle to [-π, π]
     * @param {number} angle - angle in radians
     * @returns {number}
     */
    normalizeAngle(angle) {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    },

    /**
     * Calculate angle difference (shortest path)
     * @param {number} a1, a2 - angles in radians
     * @returns {number} difference
     */
    angleDifferenceCanonical(a1, a2) {
        return this.normalizeAngle(a2 - a1);
    },

    /**
     * Two-link IK: given start point, target point, and link lengths,
     * find the two joint angles
     * @param {number} x0, y0 - start point
     * @param {number} xt, yt - target point
     * @param {number} l1, l2 - link lengths
     * @returns {{theta1: number, theta2: number} | null} angles in radians, or null if unreachable
     */
    inverseKinematics2Link(x0, y0, xt, yt, l1, l2) {
        const dx = xt - x0;
        const dy = yt - y0;
        const d = Math.sqrt(dx * dx + dy * dy);

        // Check if target is reachable
        if (d > l1 + l2 || d < Math.abs(l1 - l2)) {
            return null;
        }

        // Law of cosines for joint angle
        const cosTheta2 = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
        const clamped = Math.max(-1, Math.min(1, cosTheta2));
        const theta2 = Math.acos(clamped);  // elbow angle

        // Using atan2 for theta1
        const alpha = Math.atan2(dy, dx);
        const beta = Math.atan2(l2 * Math.sin(theta2), l1 + l2 * Math.cos(theta2));
        const theta1 = alpha - beta;

        return { theta1, theta2 };
    },

    /**
     * Clamp value to range [min, max]
     * @param {number} value, min, max
     * @returns {number}
     */
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },

    /**
     * Linear interpolation
     * @param {number} a, b - start and end values
     * @param {number} t - parameter [0, 1]
     * @returns {number}
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    /**
     * Smoothstep interpolation
     * @param {number} t - parameter [0, 1]
     * @returns {number}
     */
    smoothstep(t) {
        t = this.clamp(t, 0, 1);
        return t * t * (3 - 2 * t);
    }
};
