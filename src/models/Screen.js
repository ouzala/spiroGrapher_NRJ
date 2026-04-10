/**
 * Screen: A rotating drawing board that behaves like a hard-driven disc.
 */
class Screen extends Disc {
    constructor(id, x, y, radius, rpm, color = '#6dd3c7', transparencyMode = false) {
        super(id, x, y, radius, rpm, Infinity);
        this.kind = 'screen';
        this.color = color;
        this.transparencyMode = Boolean(transparencyMode);
    }

    isScreen() {
        return true;
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
        screen.restRpm = this.restRpm;
        screen.rpm = this.rpm;
        screen.targetRpm = this.targetRpm;
        screen.rampStartRpm = this.rampStartRpm;
        screen.rampStartTime = this.rampStartTime;
        screen.driveTargetAngle = this.driveTargetAngle;
        screen.lastDriveDtMs = this.lastDriveDtMs;
        return screen;
    }
}
