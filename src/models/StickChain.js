/**
 * StickChain: A sequence of sticks connected by revolute joints
 */
class StickChain {
    constructor(id) {
        this.id = id;
        this.sticks = [];
        this.startAttachment = null;
        this.endAttachment = null;
    }

    addStick(stick) {
        this.sticks.push(stick);
    }

    setStartAttachment(type, id, distance, angleOffset = 0) {
        this.startAttachment = { type, id, distance, angleOffset };
    }

    setEndAttachment(type, id, distance) {
        this.endAttachment = { type, id, distance };
    }

    setOpenEnd() {
        this.endAttachment = { type: 'openEnd' };
    }

    getOrder() {
        return this.sticks.length;
    }

    getStick(index) {
        return this.sticks[index];
    }

    getEndPoint() {
        if (this.sticks.length === 0) return { x: 0, y: 0 };
        return this.sticks[this.sticks.length - 1].getEndPoint();
    }

    clone() {
        const chain = new StickChain(this.id);
        for (const stick of this.sticks) {
            chain.addStick(stick.clone());
        }
        chain.startAttachment = this.startAttachment ? { ...this.startAttachment } : null;
        chain.endAttachment = this.endAttachment ? { ...this.endAttachment } : null;
        return chain;
    }
}
