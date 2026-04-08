/**
 * Stick: A rigid stick with two revolute joints
 */
class Stick {
    constructor(id, length, stiffness = 999) {
        this.id = id;                    // unique identifier
        this.length = length;            // rest length of stick (mm)
        this.stiffness = stiffness;      // spring stiffness (high values approximate rigid segments)
        this.angle = 0;                  // current angle (radians)
        this.targetAngle = 0;            // target angle (for solver convergence)
        this.startX = 0;                 // start point x (mm)
        this.startY = 0;                 // start point y (mm)
        this.endX = 0;                   // end point x (mm)
        this.endY = 0;                   // end point y (mm)
        this.actualLength = length;      // rendered length after solving
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
        this.endX = startX + this.length * Math.cos(angle);
        this.endY = startY + this.length * Math.sin(angle);
        this.actualLength = this.length;
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
        const t = this.length > 0 ? MathUtils.clamp(distance / this.length, 0, 1) : 0;
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
        const s = new Stick(this.id, this.length, this.stiffness);
        s.angle = this.angle;
        s.targetAngle = this.targetAngle;
        s.setEndpoints(this.startX, this.startY, this.endX, this.endY);
        return s;
    }
}
