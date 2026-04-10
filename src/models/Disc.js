/**
 * Disc: A rotating disc that drives the kinematic system
 */
class Disc {
    constructor(id, x, y, radius, rpm, torque = AppConfig.SYSTEM_DEFAULTS.DISC_TORQUE, color = AppConfig.COLORS.discFill) {
        this.kind = 'disc';               // model kind
        this.id = id;                    // unique identifier
        this.x = x;                      // center x position (mm)
        this.y = y;                      // center y position (mm)
        this.radius = radius;            // radius (mm)
        this.restRpm = rpm;              // preferred drive speed used by the solver
        this.rpm = rpm;                  // actual speed after solving / playback
        this.torque = torque;            // drive authority: 0..100%, Infinity/100 => hard-driven
        this.angle = 0;                  // current angle (radians, 0 at construction)
        this.targetRpm = rpm;            // target preferred rpm for smooth ramp-up
        this.rampStartRpm = rpm;         // preferred rpm at the start of a ramp
        this.rampStartTime = null;       // when ramp started
        this.rampDuration = 2000;        // 2 second ramp-up (ms)
        this.driveTargetAngle = 0;       // preferred angle after the current timestep
        this.lastDriveDtMs = 0;          // effective timestep used for the latest drive target
        this.color = color;              // disc color
        console.log(`[Disc] Created id=${id} at world (${x}, ${y}), radius=${radius}mm`);
    }

    /**
     * Update disc state for solvers that prescribe angle directly.
     * @param {number} dt - delta time (ms)
     * @param {number} timeScale - playback speed multiplier
     */
    update(dt, timeScale = 1) {
        this.updateDriveTarget(dt, timeScale);
        this.angle = this.driveTargetAngle;
        this.rpm = this.restRpm;
        this.angle = ((this.angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    }

    /**
     * Update the preferred drive target for the next timestep.
     * @param {number} dt - delta time (ms)
     * @param {number} timeScale - playback speed multiplier
     */
    updateDriveTarget(dt, timeScale = 1) {
        this.lastDriveDtMs = dt * timeScale;
        const now = performance.now();
        if (this.rampStartTime === null) {
            this.rampStartTime = now;
        }

        const elapsed = now - this.rampStartTime;
        if (elapsed < this.rampDuration) {
            const t = elapsed / this.rampDuration;
            this.restRpm = MathUtils.lerp(this.rampStartRpm, this.targetRpm, t);
        } else {
            this.restRpm = this.targetRpm;
        }

        const radsPerMs = (this.restRpm / 60) * 2 * Math.PI / 1000;
        this.driveTargetAngle = this.angle + radsPerMs * dt * timeScale;

        if (this.isHardDriven()) {
            this.angle = this.driveTargetAngle;
            this.rpm = this.restRpm;
        }
    }

    /**
     * Set target RPM with smooth ramp-up
     * @param {number} newRpm - new target RPM
     */
    setRpm(newRpm) {
        this.rampStartRpm = this.restRpm;
        this.targetRpm = newRpm;
        this.rampStartTime = performance.now();
    }

    setTorque(newTorque) {
        this.torque = newTorque;
    }

    getTorquePercent() {
        if (!Number.isFinite(this.torque)) return 100;
        return MathUtils.clamp(this.torque, 0, 100);
    }

    getTorqueRatio() {
        return this.getTorquePercent() / 100;
    }

    isHardDriven() {
        return !Number.isFinite(this.torque) || this.torque >= 100;
    }

    isFreewheel() {
        return Number.isFinite(this.torque) && this.torque <= 0;
    }

    getDriveMode() {
        if (this.isHardDriven()) return 'hardDrive';
        if (this.isFreewheel()) return 'freewheel';
        return 'torqueModulated';
    }

    getLegacyDriveBehavior() {
        return this.isHardDriven() ? 'prescribedAngle' : 'softDiscAttachment';
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

    canAcceptAttachments() {
        return true;
    }

    clone() {
        const d = new Disc(this.id, this.x, this.y, this.radius, this.restRpm, this.torque);
        d.angle = this.angle;
        d.restRpm = this.restRpm;
        d.rpm = this.rpm;
        d.targetRpm = this.targetRpm;
        d.rampStartRpm = this.rampStartRpm;
        d.rampStartTime = this.rampStartTime;
        d.driveTargetAngle = this.driveTargetAngle;
        d.lastDriveDtMs = this.lastDriveDtMs;
        return d;
    }
}
