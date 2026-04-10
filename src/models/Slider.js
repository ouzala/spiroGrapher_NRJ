/**
 * Slider: a fixed world-space hard constraint owned by a single stick.
 */
class Slider {
    constructor(id, stickId, distance, x, y) {
        this.id = id;
        this.stickId = stickId;
        this.distance = distance;
        this.x = x;
        this.y = y;
    }

    clone() {
        return new Slider(this.id, this.stickId, this.distance, this.x, this.y);
    }
}
