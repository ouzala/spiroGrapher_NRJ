/**
 * Stick: A rigid stick with two revolute joints
 */
class Stick {
    constructor(id, restLength, stiffness = AppConfig.SYSTEM_DEFAULTS.STICK_STIFFNESS) {
        this.id = id;                    // unique identifier
        this.restLength = restLength;    // zero-energy / nominal stick length (mm)
        this.stiffness = AppConfig.clampStickStiffnessPercent(stiffness); // 0-100%, where 100 is rigid
        this.angle = 0;                  // current angle (radians)
        this.targetAngle = 0;            // target angle (for solver convergence)
        this.startX = 0;                 // start point x (mm)
        this.startY = 0;                 // start point y (mm)
        this.endX = 0;                   // end point x (mm)
        this.endY = 0;                   // end point y (mm)
        this.actualLength = restLength;  // rendered length after solving
    }

    /**
     * Set stick position and angle
     * @param {number} startX - start point x
     * @param {number} startY - start point y
     * @param {number} angle - stick angle (radians)
     */
    setPosition(startX, startY, angle) {
        this.startX = startX;
        this.startY = startY;
        this.angle = angle;
        this.endX = startX + this.restLength * Math.cos(angle);
        this.endY = startY + this.restLength * Math.sin(angle);
        this.actualLength = this.restLength;
    }

    /**
     * Set explicit stick endpoints for deformed / energy-based configurations
     * @param {number} startX
     * @param {number} startY
     * @param {number} endX
     * @param {number} endY
     */
    setEndpoints(startX, startY, endX, endY) {
        this.startX = startX;
        this.startY = startY;
        this.endX = endX;
        this.endY = endY;
        this.actualLength = MathUtils.distance(startX, startY, endX, endY);
        this.angle = MathUtils.angleToPoint(startX, startY, endX, endY);
    }

    /**
     * Get point on stick at given distance from start
     * @param {number} distance - distance from start (mm)
     * @returns {{x: number, y: number}}
     */
    getPointAtDistance(distance) {
        const t = this.restLength > 0 ? MathUtils.clamp(distance / this.restLength, 0, 1) : 0;
        return {
            x: MathUtils.lerp(this.startX, this.endX, t),
            y: MathUtils.lerp(this.startY, this.endY, t)
        };
    }

    /**
     * Get end point of stick
     * @returns {{x: number, y: number}}
     */
    getEndPoint() {
        return { x: this.endX, y: this.endY };
    }

    clone() {
        const s = new Stick(this.id, this.restLength, this.stiffness);
        s.angle = this.angle;
        s.targetAngle = this.targetAngle;
        s.setEndpoints(this.startX, this.startY, this.endX, this.endY);
        return s;
    }
}
