/**
 * Screen: A rotating drawing board with its own drive state and geometry.
 */
class Screen {
    constructor(id, x, y, radius, rpm, color, transparencyMode = false) {
        this.kind = 'screen';
        this.id = id;
        this.x = x;
        this.y = y;
        this.centerAttachment = null;
        this.radius = radius;
        this.restRpm = rpm;
        this.rpm = rpm;
        this.torque = Infinity;
        this.angle = 0;
        this.targetRpm = rpm;
        this.rampStartRpm = rpm;
        this.rampStartTime = null;
        this.driveTargetAngle = 0;
        this.lastDriveDtMs = 0;
        this.color = color;
        this.transparencyMode = Boolean(transparencyMode);
        this.rampDuration = AppConfig.SYSTEM_DEFAULTS.RPM_RAMP; //  rpm ramp-up (ms)

    }

    update(dt, timeScale = 1) {
        this.updateDriveTarget(dt, timeScale);
        this.angle = this.driveTargetAngle;
        this.rpm = this.restRpm;
        this.angle = ((this.angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    }

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

    getPointOnSurface(distance, angleOffset = 0) {
        const angle = this.angle + angleOffset;
        return {
            x: this.x + distance * Math.cos(angle),
            y: this.y + distance * Math.sin(angle)
        };
    }

    getAttachmentPoint(attachmentDistance) {
        return this.getPointOnSurface(attachmentDistance);
    }

    canAcceptAttachments() {
        return !this.transparencyMode;
    }

    worldToLocal(point) {
        const dx = point.x - this.x;
        const dy = point.y - this.y;
        const cos = Math.cos(-this.angle);
        const sin = Math.sin(-this.angle);
        return {
            x: dx * cos - dy * sin,
            y: dx * sin + dy * cos
        };
    }

    localToWorld(point) {
        const cos = Math.cos(this.angle);
        const sin = Math.sin(this.angle);
        return {
            x: this.x + point.x * cos - point.y * sin,
            y: this.y + point.x * sin + point.y * cos
        };
    }

    containsWorldPoint(point) {
        return MathUtils.distance(this.x, this.y, point.x, point.y) <= this.radius + 1e-6;
    }

    clone() {
        const screen = new Screen(this.id, this.x, this.y, this.radius, this.restRpm, this.color, this.transparencyMode);
        screen.angle = this.angle;
        screen.centerAttachment = this.centerAttachment ? { ...this.centerAttachment } : null;
        screen.restRpm = this.restRpm;
        screen.rpm = this.rpm;
        screen.targetRpm = this.targetRpm;
        screen.rampStartRpm = this.rampStartRpm;
        screen.rampStartTime = this.rampStartTime;
        screen.rampDuration = this.rampDuration;
        screen.driveTargetAngle = this.driveTargetAngle;
        screen.lastDriveDtMs = this.lastDriveDtMs;
        screen.torque = this.torque;
        return screen;
    }
}
