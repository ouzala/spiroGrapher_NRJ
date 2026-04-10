/**
 * System: The complete kinematic system
 */
class System {
    constructor() {
        this.discs = [];
        this.screens = [];
        this.stickChains = [];
        this.pencils = [];
        this.anchors = [];
        this.sliders = [];
        this.nextDiscId = 1;
        this.nextScreenId = 1;
        this.nextChainId = 1;
        this.stickIdCounter = 1;
        this.nextPencilId = 1;
        this.nextAnchorId = 1;
        this.nextSliderId = 1;
        this.simTime = 0;
    }

    addDisc(x, y, radius, rpm, torque = AppConfig.SYSTEM_DEFAULTS.DISC_DEF_TORQUE) {
        const disc = new Disc(this.nextDiscId++, x, y, radius, rpm, torque);
        this.discs.push(disc);
        return disc;
    }

    addScreen(x, y, radius, rpm, color = AppConfig.COLORS.screenDefaultFill, transparencyMode = false) {
        const screen = new Screen(this.nextScreenId++, x, y, radius, rpm, color, transparencyMode);
        this.screens.push(screen);
        return screen;
    }

    addStickChain(discParentObject = null) {
        const chain = new StickChain(this.nextChainId++, discParentObject);
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
            persistenceDuration, 
        );
        this.pencils.push(pencil);
        return pencil;
    }

    addAnchor(primaryAttachment, targetAttachment) {
        const anchor = new Anchor(this.nextAnchorId++, primaryAttachment, targetAttachment);
        this.anchors.push(anchor);
        return anchor;
    }

    addOrReplaceSlider(stickId, distance, x, y) {
        const stick = this.getStickById(stickId);
        if (!stick) return null;

        const clampedDistance = MathUtils.clamp(
            Number.isFinite(distance) ? distance : 0,
            0,
            Math.max(stick.restLength || 0, 0)
        );

        const existingSlider = this.getSliderForStick(stickId);
        if (existingSlider) {
            existingSlider.distance = clampedDistance;
            existingSlider.x = x;
            existingSlider.y = y;
            stick.slider = existingSlider;
            return existingSlider;
        }

        const slider = new Slider(this.nextSliderId++, stickId, clampedDistance, x, y);
        this.sliders.push(slider);
        stick.slider = slider;
        return slider;
    }

    getDisc(id) {
        return this.discs.find(disc => disc.id === id) || null;
    }

    getScreen(id) {
        return this.screens.find(screen => screen.id === id) || null;
    }

    getDriveSurface(attachmentOrKind, id = null) {
        if (typeof attachmentOrKind === 'object' && attachmentOrKind !== null) {
            if (attachmentOrKind.type === 'disc') return this.getDisc(attachmentOrKind.id);
            if (attachmentOrKind.type === 'screen') return this.getScreen(attachmentOrKind.id);
            return null;
        }

        if (attachmentOrKind === 'disc') return this.getDisc(id);
        if (attachmentOrKind === 'screen') return this.getScreen(id);
        return null;
    }

    getRotatingBodies() {
        return [...this.discs, ...this.screens];
    }

    getRotatingBodiesTopDown() {
        return [
            ...[...this.discs].reverse(),
            ...[...this.screens].reverse()
        ];
    }

    getScreens() {
        return this.screens;
    }

    getStandardDiscs() {
        return this.discs;
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

    getSlider(id) {
        return this.sliders.find(slider => slider.id === id) || null;
    }

    getSliderForStick(stickId) {
        const stick = this.getStickById(stickId);
        if (stick?.slider) return stick.slider;
        return this.sliders.find(slider => slider.stickId === stickId) || null;
    }

    removeSlider(sliderId) {
        const slider = this.getSlider(sliderId);
        if (!slider) return;
        const stick = this.getStickById(slider.stickId);
        if (stick?.slider?.id === slider.id) {
            stick.slider = null;
        }
        this.sliders = this.sliders.filter(item => item.id !== sliderId);
    }

    removeSliderForStick(stickId) {
        const slider = this.getSliderForStick(stickId);
        if (!slider) return;
        this.removeSlider(slider.id);
    }

    nextStickId() {
        return this.stickIdCounter++;
    }

    getTotalStickCount() {
        return this.stickChains.reduce((count, chain) => count + chain.sticks.length, 0);
    }

    analyzeDiscDrives() {
        const standardDiscs = this.getStandardDiscs();
        const finiteTorqueDiscs = standardDiscs.filter(disc => !disc.isHardDriven());
        const warnings = [];

        if (finiteTorqueDiscs.length > 0) {
            const labels = finiteTorqueDiscs.map(disc => `Disc ${disc.id}`).join(', ');
            warnings.push(`${labels} use hybrid torque modulation. Their actual RPM can deviate from rest RPM to satisfy exact mechanism constraints.`);
        }

        return {
            hardDrivenCount: standardDiscs.length - finiteTorqueDiscs.length,
            torqueLimitedCount: finiteTorqueDiscs.length,
            finiteTorqueDiscIds: finiteTorqueDiscs.map(disc => disc.id),
            screenCount: this.getScreens().length,
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

        for (const slider of this.sliders) {
            if (!slider) continue;
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
            return { valid: false, message: 'System needs at least 1 actuator' };
        }
        if (this.discs.length > AppConfig.VALIDATORS.MAX_ACTUATORS) {
            return { valid: false, message: `Too many disc actuators (max ${AppConfig.VALIDATORS.MAX_ACTUATORS} )` };
        }
        if (this.stickChains.length > AppConfig.VALIDATORS.MAX_CHAINS) {
            return { valid: false, message: `Too many segment chains (max ${AppConfig.VALIDATORS.MAX_CHAINS} )` };
        }
        if (this.anchors.length > AppConfig.VALIDATORS.MAX_ANCHORS) {
            return { valid: false, message: `Too many Anchors (max ${AppConfig.VALIDATORS.MAX_ANCHORS} )` };
        }
        if (this.sliders.length > AppConfig.VALIDATORS.MAX_SLIDERS) {
            return { valid: false, message: `Too many Sliders (max ${AppConfig.VALIDATORS.MAX_SLIDERS} )` };
        }
        if (this.screens.length > AppConfig.VALIDATORS.MAX_SCREENS) {
            return { valid: false, message: `Too many Screens (max ${AppConfig.VALIDATORS.MAX_SCREENS} )` };
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

            if ((chain.startAttachment.type === 'disc' || chain.startAttachment.type === 'screen')
                && !this.getDriveSurface(chain.startAttachment)) {
                return { valid: false, message: `Chain ${chain.id}: ${chain.startAttachment.type} ${chain.startAttachment.id} not found` };
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
            } else if (targetType === 'disc' || targetType === 'screen') {
                if (!this.getDriveSurface(anchor.targetAttachment)) {
                    return { valid: false, message: `Anchor ${anchor.id}: target ${targetType} ${anchor.targetAttachment.id} not found` };
                }
            } else if (targetType === 'fixedPoint') {
                if (!Number.isFinite(anchor.targetAttachment.x) || !Number.isFinite(anchor.targetAttachment.y)) {
                    return { valid: false, message: `Anchor ${anchor.id}: invalid fixed point target` };
                }
            } else {
                return { valid: false, message: `Anchor ${anchor.id}: invalid target attachment` };
            }
        }

        const sliderStickIds = new Set();
        for (const slider of this.sliders) {
            const stick = this.getStickById(slider.stickId);
            if (!stick) {
                return { valid: false, message: `Slider ${slider.id}: host stick ${slider.stickId} not found` };
            }
            if (!Number.isFinite(slider.distance)) {
                return { valid: false, message: `Slider ${slider.id}: invalid distance` };
            }
            if (!Number.isFinite(slider.x) || !Number.isFinite(slider.y)) {
                return { valid: false, message: `Slider ${slider.id}: invalid target position` };
            }
            if (slider.distance < -1e-6 || slider.distance > stick.restLength + 1e-6) {
                return { valid: false, message: `Slider ${slider.id}: distance lies outside host stick` };
            }
            if (sliderStickIds.has(slider.stickId)) {
                return { valid: false, message: `Stick ${slider.stickId}: can own only 1 slider` };
            }
            sliderStickIds.add(slider.stickId);
            if (stick.slider?.id !== slider.id) {
                return { valid: false, message: `Slider ${slider.id}: host stick ownership mismatch` };
            }
        }

        return { valid: true, message: 'System is valid' };
    }

    getStatus() {
        const validation = this.validate();
        const driveAnalysis = this.analyzeDiscDrives();
        const driveNote = driveAnalysis.warnings.length > 0 ? ` ${driveAnalysis.warnings[0]}` : '';
        return `Discs: ${this.getStandardDiscs().length}, Screens: ${this.getScreens().length}, Chains: ${this.stickChains.length}, Anchors: ${this.anchors.length}, Sliders: ${this.sliders.length}, Pencils: ${this.pencils.length}. ${validation.message}${driveNote}`;
    }

    removeDisc(discId) {
        this.discs = this.discs.filter(disc => disc.id !== discId);
        this.removeAttachmentsForDriveSurface('disc', discId);
    }

    removeScreen(screenId) {
        this.screens = this.screens.filter(screen => screen.id !== screenId);
        this.removeAttachmentsForDriveSurface('screen', screenId);
    }

    removeAttachmentsForDriveSurface(surfaceType, surfaceId) {
        for (const body of this.getRotatingBodies()) {
            const attachmentType = this.getAttachmentType(body.centerAttachment);
            if (attachmentType === surfaceType && body.centerAttachment.id === surfaceId) {
                body.centerAttachment = null;
            }
        }

        const removedChainIds = new Set();
        const removedStickIds = new Set();
        this.stickChains = this.stickChains.filter(chain => {
            const removeChain = chain.startAttachment?.type === surfaceType && chain.startAttachment.id === surfaceId;
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
            return targetType !== surfaceType || anchor.targetAttachment.id !== surfaceId;
        });
        this.sliders = this.sliders.filter(slider => {
            if (!removedStickIds.has(slider.stickId)) return true;
            const stick = this.getStickById(slider.stickId);
            if (stick?.slider?.id === slider.id) {
                stick.slider = null;
            }
            return false;
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
        this.sliders = this.sliders.filter(slider => !removedStickIds.has(slider.stickId));
        for (const stickId of removedStickIds) {
            const stick = this.getStickById(stickId);
            if (stick) {
                stick.slider = null;
            }
        }

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

    getScreenAtPoint(point) {
        this.syncAttachedRotatingBodies();
        for (let i = this.screens.length - 1; i >= 0; i--) {
            const screen = this.screens[i];
            if (!screen.containsWorldPoint(point)) continue;
            return screen;
        }
        return null;
    }

    syncAttachedRotatingBodies() {
        const cache = new Map();
        const visiting = new Set();

        for (const body of this.getRotatingBodies()) {
            this.resolveAttachedRotatingBodyPosition(body, cache, visiting);
        }
    }

    resolveAttachedRotatingBodyPosition(body, cache = new Map(), visiting = new Set()) {
        const key = `${body.kind}:${body.id}`;
        if (cache.has(key)) {
            return cache.get(key);
        }
        if (visiting.has(key)) {
            return { x: body.x, y: body.y };
        }

        visiting.add(key);

        let resolved = { x: body.x, y: body.y };
        const attachmentType = this.getAttachmentType(body.centerAttachment);
        if (attachmentType === 'disc' || attachmentType === 'screen') {
            const parent = this.getDriveSurface(body.centerAttachment);
            if (parent && !this.wouldCreateRotatingBodyCycle(body, body.centerAttachment)) {
                this.resolveAttachedRotatingBodyPosition(parent, cache, visiting);
                resolved = parent.getPointOnSurface(
                    body.centerAttachment.distance || 0,
                    body.centerAttachment.angleOffset || 0
                );
            }
        }

        body.x = resolved.x;
        body.y = resolved.y;
        cache.set(key, resolved);
        visiting.delete(key);
        return resolved;
    }

    findAttachableRotatingBodyAtPoint(point, options = {}) {
        const exclude = options.exclude || null;
        this.syncAttachedRotatingBodies();

        for (const body of this.getRotatingBodiesTopDown()) {
            if (exclude && body.kind === exclude.kind && body.id === exclude.id) continue;
            if (!body.containsWorldPoint(point)) continue;
            if (!body.canAcceptAttachments()) continue;
            if (exclude && this.wouldCreateRotatingBodyCycle(exclude, { type: body.kind, id: body.id })) continue;
            return body;
        }

        return null;
    }

    wouldCreateRotatingBodyCycle(surface, targetAttachment) {
        if (!surface || !targetAttachment) return false;

        let current = this.getDriveSurface(targetAttachment);
        const visited = new Set();
        while (current) {
            const key = `${current.kind}:${current.id}`;
            if (visited.has(key)) return true;
            if (current.kind === surface.kind && current.id === surface.id) {
                return true;
            }
            visited.add(key);

            const attachmentType = this.getAttachmentType(current.centerAttachment);
            if (attachmentType !== 'disc' && attachmentType !== 'screen') {
                return false;
            }
            current = this.getDriveSurface(current.centerAttachment);
        }

        return false;
    }

    clone() {
        const newSys = new System();

        for (const disc of this.discs) {
            const newDisc = disc.clone();
            newSys.discs.push(newDisc);
            newSys.nextDiscId = Math.max(newSys.nextDiscId, newDisc.id + 1);
        }

        for (const screen of this.screens) {
            const newScreen = screen.clone();
            newSys.screens.push(newScreen);
            newSys.nextScreenId = Math.max(newSys.nextScreenId, newScreen.id + 1);
        }

        for (const chain of this.stickChains) {
            const newChain = chain.clone();
            newChain.discParentObject = newChain.startAttachment
                ? newSys.getDriveSurface(newChain.startAttachment)
                : null;
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

        for (const slider of this.sliders) {
            const newSlider = slider.clone();
            newSys.sliders.push(newSlider);
            newSys.nextSliderId = Math.max(newSys.nextSliderId, newSlider.id + 1);
            const stick = newSys.getStickById(newSlider.stickId);
            if (stick) {
                stick.slider = newSlider;
            }
        }

        newSys.stickIdCounter = this.stickIdCounter;
        newSys.simTime = this.simTime;
        return newSys;
    }

    clear() {
        this.discs = [];
        this.screens = [];
        this.stickChains = [];
        this.pencils = [];
        this.anchors = [];
        this.sliders = [];
        this.nextDiscId = 1;
        this.nextScreenId = 1;
        this.nextChainId = 1;
        this.stickIdCounter = 1;
        this.nextPencilId = 1;
        this.nextAnchorId = 1;
        this.nextSliderId = 1;
        this.simTime = 0;
    }
}
