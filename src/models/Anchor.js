/**
 * Anchor: A manual articulation that constrains a point on a primary stick
 * to another element or a fixed canvas point.
 */
class Anchor {
    constructor(id, primaryAttachment, targetAttachment) {
        this.id = id;
        this.primaryAttachment = primaryAttachment;
        this.targetAttachment = targetAttachment;
    }

    clone() {
        return new Anchor(
            this.id,
            this.primaryAttachment ? { ...this.primaryAttachment } : null,
            this.targetAttachment ? { ...this.targetAttachment } : null
        );
    }
}
