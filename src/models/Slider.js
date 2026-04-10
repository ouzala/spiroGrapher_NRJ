/**
 * Slider: a fixed world-space hard constraint owned by a single stick.
 */
class Slider {
    constructor(id, stickId, distance, targetAttachment = null, x = 0, y = 0) {
        this.id = id;
        this.stickId = stickId;
        this.distance = distance;
        this.targetAttachment = targetAttachment;
        this.x = x;
        this.y = y;
    }

    clone() {
        return new Slider(
            this.id,
            this.stickId,
            this.distance,
            this.targetAttachment ? { ...this.targetAttachment } : null,
            this.x,
            this.y
        );
    }
}
