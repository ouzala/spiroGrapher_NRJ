/**
 * Stick: A rigid stick with two revolute joints
 */
class Stick {
    constructor(id, length) {
        this.id = id;                    // unique identifier
        this.length = length;            // length of stick (mm)
        this.angle = 0;                  // current angle (radians)
        this.targetAngle = 0;            // target angle (for solver convergence)
        this.startX = 0;                 // start point x (mm)
        this.startY = 0;                 // start point y (mm)
        this.endX = 0;                   // end point x (mm)
        this.endY = 0;                   // end point y (mm)
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
    }

    /**
     * Get point on stick at given distance from start
     * @param {number} distance - distance from start (mm)
     * @returns {{x: number, y: number}}
     */
    getPointAtDistance(distance) {
        distance = Math.min(distance, this.length);
        return {
            x: this.startX + distance * Math.cos(this.angle),
            y: this.startY + distance * Math.sin(this.angle)
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
        const s = new Stick(this.id, this.length);
        s.angle = this.angle;
        s.targetAngle = this.targetAngle;
        s.setPosition(this.startX, this.startY, this.angle);
        return s;
    }
}
