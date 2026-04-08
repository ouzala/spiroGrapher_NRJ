/**
 * System: The complete kinematic system
 */
class System {
    constructor() {
        this.discs = [];
        this.stickChains = [];
        this.pencils = [];
        this.anchors = [];
        this.nextDiscId = 1;
        this.nextChainId = 1;
        this.stickIdCounter = 1;
        this.nextPencilId = 1;
        this.nextAnchorId = 1;
        this.simTime = 0;
    }

    addDisc(x, y, radius, rpm, torque = Infinity) {
        const disc = new Disc(this.nextDiscId++, x, y, radius, rpm, torque);
        this.discs.push(disc);
        return disc;
    }

    addStickChain() {
        const chain = new StickChain(this.nextChainId++);
        this.stickChains.push(chain);
        return chain;
    }

    addPencil(stickChainId, stickIndex, positionOnStick, color, persistenceDuration) {
        const pencil = new Pencil(
            this.nextPencilId++,
            stickChainId,
            stickIndex,
            positionOnStick,
            color,
            persistenceDuration
        );
        this.pencils.push(pencil);
        return pencil;
    }

    addAnchor(primaryAttachment, targetAttachment) {
        const anchor = new Anchor(this.nextAnchorId++, primaryAttachment, targetAttachment);
        this.anchors.push(anchor);
        return anchor;
    }

    getDisc(id) {
        return this.discs.find(disc => disc.id === id) || null;
    }

    getStickChain(id) {
        return this.stickChains.find(chain => chain.id === id) || null;
    }

    getStickById(id) {
        for (const chain of this.stickChains) {
            for (const stick of chain.sticks) {
                if (stick.id === id) {
                    return stick;
                }
            }
        }
        return null;
    }

    getStickPlacement(stickId) {
        for (const chain of this.stickChains) {
            for (let i = 0; i < chain.sticks.length; i++) {
                if (chain.sticks[i].id === stickId) {
                    return { chain, chainId: chain.id, stickIndex: i };
                }
            }
        }
        return null;
    }

    getPencil(id) {
        return this.pencils.find(pencil => pencil.id === id) || null;
    }

    getAnchor(id) {
        return this.anchors.find(anchor => anchor.id === id) || null;
    }

    nextStickId() {
        return this.stickIdCounter++;
    }

    getTotalStickCount() {
        return this.stickChains.reduce((count, chain) => count + chain.sticks.length, 0);
    }

    analyzeDiscDrives() {
        const finiteTorqueDiscs = this.discs.filter(disc => Number.isFinite(disc.torque));
        const warnings = [];

        if (finiteTorqueDiscs.length > 0) {
            const labels = finiteTorqueDiscs.map(disc => `Disc ${disc.id}`).join(', ');
            warnings.push(`${labels} use finite torque and are solved as soft disc attachments. Disc rotation is still prescribed by RPM; full torque-driven disc dynamics are not implemented yet.`);
        }

        return {
            hardDrivenCount: this.discs.length - finiteTorqueDiscs.length,
            torqueLimitedCount: finiteTorqueDiscs.length,
            finiteTorqueDiscIds: finiteTorqueDiscs.map(disc => disc.id),
            warnings
        };
    }

    normalizeAttachmentType(type) {
        return type;
    }

    getAttachmentType(attachment) {
        if (!attachment) return null;
        if (attachment.type === 'stick') return 'anchor';
        if (attachment.type === 'anchor' && Number.isFinite(attachment.x) && Number.isFinite(attachment.y) && !('id' in attachment)) {
            return 'fixedPoint';
        }
        return this.normalizeAttachmentType(attachment.type);
    }

    isHardEndAttachment(attachment) {
        const type = this.getAttachmentType(attachment);
        return type === 'anchor' || type === 'fixedPoint';
    }

    analyzeConstraints() {
        const unknownAngles = this.getTotalStickCount();
        let hardConstraintCount = 0;
        let hardCouplingCount = 0;
        const notes = [];

        for (const chain of this.stickChains) {
            if (!chain.endAttachment) continue;

            if (this.isHardEndAttachment(chain.endAttachment)) {
                hardConstraintCount += 2;
                hardCouplingCount += 1;
            } else if (this.getAttachmentType(chain.endAttachment) === 'openEnd') {
                notes.push(`Chain ${chain.id} has an open end`);
            }
        }

        for (const anchor of this.anchors) {
            if (!anchor.primaryAttachment || !anchor.targetAttachment) continue;
            hardConstraintCount += 2;
            hardCouplingCount += 1;
        }

        if (unknownAngles === 0) {
            return {
                sufficient: false,
                unknownAngles,
                hardConstraintCount,
                hardCouplingCount,
                message: 'System needs at least 1 stick before playback.'
            };
        }

        if (hardConstraintCount === 0) {
            return {
                sufficient: false,
                unknownAngles,
                hardConstraintCount,
                hardCouplingCount,
                message: 'Constraints insufficient, add elements to close the system.'
            };
        }

        if (hardConstraintCount < unknownAngles) {
            return {
                sufficient: false,
                unknownAngles,
                hardConstraintCount,
                hardCouplingCount,
                message: 'Constraints insufficient, add elements to close the system.'
            };
        }

        return {
            sufficient: true,
            unknownAngles,
            hardConstraintCount,
            hardCouplingCount,
            message: notes.length > 0 ? notes.join('. ') : 'Constraint count is sufficient for playback.'
        };
    }

    validate() {
        if (this.discs.length === 0) {
            return { valid: false, message: 'System needs at least 1 disc' };
        }
        if (this.discs.length > 4) {
            return { valid: false, message: 'Too many discs (max 4)' };
        }
        if (this.stickChains.length === 0) {
            return { valid: false, message: 'System needs at least 1 stick chain' };
        }

        for (const chain of this.stickChains) {
            if (chain.sticks.length === 0) {
                return { valid: false, message: `Chain ${chain.id}: needs at least 1 stick` };
            }
            if (!chain.startAttachment) {
                return { valid: false, message: `Chain ${chain.id}: missing start attachment` };
            }
            if (!chain.endAttachment) {
                return { valid: false, message: `Chain ${chain.id}: missing end attachment` };
            }

            if (chain.startAttachment.type === 'disc' && !this.getDisc(chain.startAttachment.id)) {
                return { valid: false, message: `Chain ${chain.id}: disc ${chain.startAttachment.id} not found` };
            }

            if (this.getAttachmentType(chain.endAttachment) === 'anchor') {
                const targetStick = this.getStickById(chain.endAttachment.id);
                if (!targetStick) {
                    return { valid: false, message: `Chain ${chain.id}: target stick ${chain.endAttachment.id} not found` };
                }
                if (chain.sticks.some(stick => stick.id === targetStick.id)) {
                    return { valid: false, message: `Chain ${chain.id}: cannot attach to itself` };
                }
            }

            if (this.getAttachmentType(chain.endAttachment) === 'fixedPoint') {
                if (!Number.isFinite(chain.endAttachment.x) || !Number.isFinite(chain.endAttachment.y)) {
                    return { valid: false, message: `Chain ${chain.id}: invalid fixed point endpoint` };
                }
            }

            for (const pencil of this.pencils) {
                if (pencil.stickChainId === chain.id && pencil.stickIndex >= chain.sticks.length) {
                    return { valid: false, message: `Pencil ${pencil.id}: stick index out of range` };
                }
            }
        }

        for (const anchor of this.anchors) {
            if (!anchor.primaryAttachment || anchor.primaryAttachment.type !== 'stick') {
                return { valid: false, message: `Anchor ${anchor.id}: invalid primary stick attachment` };
            }

            const primaryStick = this.getStickById(anchor.primaryAttachment.id);
            if (!primaryStick) {
                return { valid: false, message: `Anchor ${anchor.id}: primary stick ${anchor.primaryAttachment.id} not found` };
            }

            const targetType = this.getAttachmentType(anchor.targetAttachment);
            if (targetType === 'anchor') {
                const targetStick = this.getStickById(anchor.targetAttachment.id);
                if (!targetStick) {
                    return { valid: false, message: `Anchor ${anchor.id}: target stick ${anchor.targetAttachment.id} not found` };
                }
                if (targetStick.id === primaryStick.id) {
                    return { valid: false, message: `Anchor ${anchor.id}: cannot target its own primary stick` };
                }
            } else if (targetType === 'disc') {
                if (!this.getDisc(anchor.targetAttachment.id)) {
                    return { valid: false, message: `Anchor ${anchor.id}: target disc ${anchor.targetAttachment.id} not found` };
                }
            } else if (targetType === 'fixedPoint') {
                if (!Number.isFinite(anchor.targetAttachment.x) || !Number.isFinite(anchor.targetAttachment.y)) {
                    return { valid: false, message: `Anchor ${anchor.id}: invalid fixed point target` };
                }
            } else {
                return { valid: false, message: `Anchor ${anchor.id}: invalid target attachment` };
            }
        }

        return { valid: true, message: 'System is valid' };
    }

    getStatus() {
        const validation = this.validate();
        const driveAnalysis = this.analyzeDiscDrives();
        const driveNote = driveAnalysis.warnings.length > 0 ? ` ${driveAnalysis.warnings[0]}` : '';
        return `Discs: ${this.discs.length}, Chains: ${this.stickChains.length}, Anchors: ${this.anchors.length}, Pencils: ${this.pencils.length}. ${validation.message}${driveNote}`;
    }

    removeDisc(discId) {
        this.discs = this.discs.filter(disc => disc.id !== discId);
        const removedChainIds = new Set();
        const removedStickIds = new Set();
        this.stickChains = this.stickChains.filter(chain => {
            const removeChain = chain.startAttachment?.type === 'disc' && chain.startAttachment.id === discId;
            if (removeChain) {
                removedChainIds.add(chain.id);
                for (const stick of chain.sticks) {
                    removedStickIds.add(stick.id);
                }
            }
            return !removeChain;
        });
        this.pencils = this.pencils.filter(pencil => !removedChainIds.has(pencil.stickChainId));
        this.anchors = this.anchors.filter(anchor => {
            const targetType = this.getAttachmentType(anchor.targetAttachment);
            if (removedStickIds.has(anchor.primaryAttachment?.id)) {
                return false;
            }
            if (targetType === 'anchor' && removedStickIds.has(anchor.targetAttachment.id)) {
                return false;
            }
            return targetType !== 'disc' || anchor.targetAttachment.id !== discId;
        });
    }

    removeStick(chainId, stickIndex) {
        const chain = this.getStickChain(chainId);
        if (!chain) return;

        const removedSticks = chain.sticks.slice(stickIndex);
        const removedStickIds = new Set(removedSticks.map(stick => stick.id));
        chain.sticks.splice(stickIndex);
        this.pencils = this.pencils.filter(pencil => {
            if (pencil.stickChainId !== chainId) return true;
            return pencil.stickIndex < stickIndex;
        });
        this.anchors = this.anchors.filter(anchor => {
            const targetType = this.getAttachmentType(anchor.targetAttachment);
            if (removedStickIds.has(anchor.primaryAttachment?.id)) {
                return false;
            }
            if (targetType === 'anchor' && removedStickIds.has(anchor.targetAttachment.id)) {
                return false;
            }
            return true;
        });

        if (chain.sticks.length === 0) {
            this.stickChains = this.stickChains.filter(item => item.id !== chainId);
            this.pencils = this.pencils.filter(pencil => pencil.stickChainId !== chainId);
            return;
        }

        chain.setOpenEnd();
    }

    removePencil(pencilId) {
        this.pencils = this.pencils.filter(pencil => pencil.id !== pencilId);
    }

    clone() {
        const newSys = new System();

        for (const disc of this.discs) {
            const newDisc = disc.clone();
            newSys.discs.push(newDisc);
            newSys.nextDiscId = Math.max(newSys.nextDiscId, newDisc.id + 1);
        }

        for (const chain of this.stickChains) {
            const newChain = chain.clone();
            newSys.stickChains.push(newChain);
            newSys.nextChainId = Math.max(newSys.nextChainId, newChain.id + 1);
        }

        for (const pencil of this.pencils) {
            const newPencil = pencil.clone();
            newSys.pencils.push(newPencil);
            newSys.nextPencilId = Math.max(newSys.nextPencilId, newPencil.id + 1);
        }

        for (const anchor of this.anchors) {
            const newAnchor = anchor.clone();
            newSys.anchors.push(newAnchor);
            newSys.nextAnchorId = Math.max(newSys.nextAnchorId, newAnchor.id + 1);
        }

        newSys.stickIdCounter = this.stickIdCounter;
        newSys.simTime = this.simTime;
        return newSys;
    }

    clear() {
        this.discs = [];
        this.stickChains = [];
        this.pencils = [];
        this.anchors = [];
        this.nextDiscId = 1;
        this.nextChainId = 1;
        this.stickIdCounter = 1;
        this.nextPencilId = 1;
        this.nextAnchorId = 1;
        this.simTime = 0;
    }
}
