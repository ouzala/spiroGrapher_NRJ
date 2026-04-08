/**
 * Disc: A rotating disc that drives the kinematic system
 */
class Disc {
    constructor(id, x, y, radius, rpm) {
        this.id = id;                    // unique identifier
        this.x = x;                      // center x position (mm)
        this.y = y;                      // center y position (mm)
        this.radius = radius;            // radius (mm)
        this.rpm = rpm;                  // rotation speed (revolutions per minute)
        this.angle = 0;                  // current angle (radians, 0 at construction)
        this.targetRpm = rpm;            // target rpm for smooth ramp-up
        this.rampStartTime = null;       // when ramp started
        this.rampDuration = 2000;        // 2 second ramp-up (ms)
        console.log(`[Disc] Created id=${id} at world (${x}, ${y}), radius=${radius}mm`);
    }

    /**
     * Update disc angle based on elapsed time
     * @param {number} dt - delta time (ms)
     * @param {number} timeScale - playback speed multiplier
     */
    update(dt, timeScale = 1) {
        // Interpolate rpm towards target over ramp duration
        const now = performance.now();
        if (this.rampStartTime === null) {
            this.rampStartTime = now;
        }

        const elapsed = now - this.rampStartTime;
        if (elapsed < this.rampDuration) {
            const t = elapsed / this.rampDuration;
            this.rpm = this.rpm + (this.targetRpm - this.rpm) * t;
        } else {
            this.rpm = this.targetRpm;
        }

        // Increment angle
        // rpm -> revolutions per second: rpm / 60
        // revolutions per second -> radians per second: (rpm/60) * 2π
        // radians per dt: (rpm/60) * 2π * (dt/1000)
        const radsPerMs = (this.rpm / 60) * 2 * Math.PI / 1000;
        this.angle += radsPerMs * dt * timeScale;
        this.angle = this.angle % (2 * Math.PI);  // keep in [0, 2π)
    }

    /**
     * Set target RPM with smooth ramp-up
     * @param {number} newRpm - new target RPM
     */
    setRpm(newRpm) {
        this.targetRpm = newRpm;
        this.rampStartTime = performance.now();
    }

    /**
     * Get point on disc surface at given distance from center
     * @param {number} distance - distance from center (mm)
     * @param {number} angleOffset - angle offset from disc rotation (radians)
     * @returns {{x: number, y: number}}
     */
    getPointOnSurface(distance, angleOffset = 0) {
        const angle = this.angle + angleOffset;
        return {
            x: this.x + distance * Math.cos(angle),
            y: this.y + distance * Math.sin(angle)
        };
    }

    /**
     * Get attachment point (where stick connects to disc)
     * @param {number} attachmentDistance - distance from disc center (mm)
     * @returns {{x: number, y: number}}
     */
    getAttachmentPoint(attachmentDistance) {
        return this.getPointOnSurface(attachmentDistance);
    }

    clone() {
        const d = new Disc(this.id, this.x, this.y, this.radius, this.rpm);
        d.angle = this.angle;
        d.targetRpm = this.targetRpm;
        return d;
    }
}
