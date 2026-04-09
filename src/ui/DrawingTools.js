/**
 * DrawingTools: UI for building and editing the kinematic system
 */
class DrawingTools {
    constructor(app) {
        this.app = app;
        this.activeTool = null;
        this.pendingDiscStart = null;
        this.pendingDiscRadius = 0;
        this.pendingStick = null;
        this.dragState = null;
        this.discModalMode = 'add';
        this.editingDiscId = null;
        this.editingPencilId = null;
        this.editingStickTarget = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('tool-disc').addEventListener('click', () => this.activateTool('disc'));
        document.getElementById('tool-stick').addEventListener('click', () => this.activateTool('stick'));
        document.getElementById('tool-anchor').addEventListener('click', () => this.activateTool('anchor'));
        document.getElementById('tool-pencil').addEventListener('click', () => this.activateTool('pencil'));

        document.getElementById('btn-validate').addEventListener('click', () => this.validateSystem());
        document.getElementById('btn-clear').addEventListener('click', () => this.clearSystem());

        document.getElementById('btn-confirm-disc').addEventListener('click', () => this.confirmDisc());
        document.getElementById('btn-cancel-disc').addEventListener('click', () => this.closeDiscModal());
        document.getElementById('btn-delete-disc').addEventListener('click', () => this.deleteDisc());

        document.getElementById('btn-confirm-pencil').addEventListener('click', () => this.confirmPencil());
        document.getElementById('btn-cancel-pencil').addEventListener('click', () => this.closePencilModal());
        document.getElementById('btn-delete-pencil').addEventListener('click', () => this.deletePencil());

        document.getElementById('btn-close-stick-menu').addEventListener('click', () => this.closeStickMenu());
        document.getElementById('btn-delete-stick').addEventListener('click', () => this.deleteStick());
        document.getElementById('btn-save-stick').addEventListener('click', () => this.saveStickSettings());
        document.getElementById('btn-add-next-stick').addEventListener('click', () => this.startAppendStick());

        const canvas = this.app.renderer.canvas;
        canvas.addEventListener('mousedown', event => this.onCanvasMouseDown(event));
        canvas.addEventListener('mousemove', event => this.onCanvasMouseMove(event));
        canvas.addEventListener('mouseup', event => this.onCanvasMouseUp(event));
        canvas.addEventListener('mouseleave', event => this.onCanvasMouseUp(event));
        canvas.addEventListener('wheel', event => this.onCanvasWheel(event), { passive: false });
        canvas.addEventListener('contextmenu', event => event.preventDefault());

        const managementButtonIds = [
            'btn-validate',
            'btn-print',
            'btn-load-test',
            'btn-toggle-solver',
            'btn-clear',
            'btn-clear-traces',
            'btn-toggle-mechanics',
            'btn-system-play-toggle'
        ];

        for (const id of managementButtonIds) {
            const button = document.getElementById(id);
            if (!button) continue;
            button.addEventListener('click', () => this.deactivateTool());
        }
    }

    activateTool(toolName) {
        this.cancelPendingConstruction();
        this.activeTool = toolName;
        document.getElementById('tool-disc').classList.toggle('active', this.activeTool === 'disc');
        document.getElementById('tool-stick').classList.toggle('active', this.activeTool === 'stick');
        document.getElementById('tool-anchor').classList.toggle('active', this.activeTool === 'anchor');
        document.getElementById('tool-pencil').classList.toggle('active', this.activeTool === 'pencil');
        this.updateStatus();
    }

    deactivateTool() {
        if (!this.activeTool && !this.pendingDiscStart && !this.pendingStick) return;
        this.cancelPendingConstruction();
        this.activeTool = null;
        document.getElementById('tool-disc').classList.remove('active');
        document.getElementById('tool-stick').classList.remove('active');
        document.getElementById('tool-anchor').classList.remove('active');
        document.getElementById('tool-pencil').classList.remove('active');
        this.updateStatus();
    }

    cancelPendingConstruction() {
        this.pendingDiscStart = null;
        this.pendingDiscRadius = 0;
        this.pendingStick = null;
        this.dragState = null;
    }

    getCanvasEventData(event) {
        const rect = this.app.renderer.canvas.getBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        const world = this.app.renderer.canvasToWorld(canvasX, canvasY);
        return { canvasX, canvasY, world };
    }

    hasModalOpen() {
        return Boolean(document.querySelector('.modal.active'));
    }

    pauseForEditing() {
        this.app.pauseForEditing();
    }

    onCanvasMouseDown(event) {
        if (this.hasModalOpen()) return;

        const { canvasX, canvasY, world } = this.getCanvasEventData(event);
        const hit = this.app.renderer.hitTest(canvasX, canvasY, this.app.system, 10);

        if (this.activeTool === 'disc' && event.button === 0) {
            this.pauseForEditing();
            this.startDiscPlacement(world);
            return;
        }

        if (this.activeTool === 'stick' && event.button === 0) {
            this.pauseForEditing();
            this.handleStickToolClick(world, canvasX, canvasY, hit);
            return;
        }

        if (this.activeTool === 'anchor' && event.button === 0) {
            this.pauseForEditing();
            this.handleAnchorToolClick(world, canvasX, canvasY);
            return;
        }

        if (this.activeTool === 'pencil' && event.button === 0) {
            this.pauseForEditing();
            this.handlePencilToolClick(canvasX, canvasY);
            return;
        }

        if (event.button === 0 && hit?.type === 'disc-center') {
            this.pauseForEditing();
            this.dragState = { type: 'disc-move', discId: hit.id, lastWorld: world, moved: false };
            return;
        }

        if (event.button === 2) {
            let menuTarget = null;
            if (hit?.type === 'pencil') {
                menuTarget = { type: 'pencil-menu', pencilId: hit.id };
            } else if (hit?.type === 'disc-center') {
                menuTarget = { type: 'disc-menu', discId: hit.id };
            } else if (hit?.type === 'stick') {
                menuTarget = { type: 'stick-menu', chainId: hit.chainId, stickIndex: hit.stickIndex };
            }
            this.dragState = { type: 'context-pan', lastCanvasX: canvasX, lastCanvasY: canvasY, moved: false, menuTarget };
            return;
        }

        if (event.button !== 0) return;

        if (hit?.type === 'pencil') {
            this.pauseForEditing();
            this.dragState = { type: 'pencil-move', pencilId: hit.id, moved: false };
            return;
        }

        if (hit?.type === 'stick-start') {
            this.pauseForEditing();
            this.dragState = { type: 'stick-start-move', chainId: hit.chainId, moved: false };
            return;
        }

        if (hit?.type === 'stick-end') {
            this.pauseForEditing();
            this.dragState = { type: 'stick-end-move', chainId: hit.chainId, moved: false };
            return;
        }

    }

    onCanvasMouseMove(event) {
        const { canvasX, canvasY, world } = this.getCanvasEventData(event);

        if (this.dragState?.type === 'disc-placement') {
            this.pendingDiscRadius = Math.max(0, MathUtils.distance(
                this.dragState.anchor.x,
                this.dragState.anchor.y,
                world.x,
                world.y
            ));
            if (this.pendingDiscRadius > 2) {
                this.dragState.moved = true;
            }
            this.updateStatus(`Disc radius: ${this.pendingDiscRadius.toFixed(1)} mm`);
            return;
        }

        if (this.dragState?.type === 'disc-move') {
            const disc = this.app.system.getDisc(this.dragState.discId);
            if (!disc) return;
            disc.x += world.x - this.dragState.lastWorld.x;
            disc.y += world.y - this.dragState.lastWorld.y;
            this.dragState.lastWorld = world;
            this.dragState.moved = true;
            this.refreshGeometry();
            this.updateStatus(`Disc ${disc.id} moved.`);
            return;
        }

        if (this.dragState?.type === 'context-pan') {
            this.dragState.moved = true;
            this.app.renderer.panBy(canvasX - this.dragState.lastCanvasX, canvasY - this.dragState.lastCanvasY);
            this.dragState.lastCanvasX = canvasX;
            this.dragState.lastCanvasY = canvasY;
            return;
        }

        if (this.dragState?.type === 'pencil-move') {
            this.dragState.moved = true;
            this.movePencilToCanvas(this.dragState.pencilId, canvasX, canvasY);
            return;
        }

        if (this.dragState?.type === 'stick-start-move') {
            this.dragState.moved = true;
            this.moveStickStartToWorld(this.dragState.chainId, world, canvasX, canvasY);
            return;
        }

        if (this.dragState?.type === 'stick-end-move') {
            this.dragState.moved = true;
            this.moveStickEndToWorld(this.dragState.chainId, world, canvasX, canvasY);
            return;
        }

        if (this.activeTool === 'disc' && this.pendingDiscStart) {
            this.pendingDiscRadius = Math.max(0, MathUtils.distance(
                this.pendingDiscStart.x,
                this.pendingDiscStart.y,
                world.x,
                world.y
            ));
            this.updateStatus(`Disc radius: ${this.pendingDiscRadius.toFixed(1)} mm`);
            return;
        }

        if (this.activeTool === 'stick' && this.pendingStick) {
            const preview = this.getStickPreviewForWorld(world, canvasX, canvasY, this.pendingStick.chainId);
            this.pendingStick.previewEnd = preview.end;
            this.pendingStick.previewAttachment = preview.attachment;
            this.updateStatus(`Stick length: ${preview.length.toFixed(1)} mm`);
        }
    }

    onCanvasMouseUp(event) {
        if (!this.dragState) return;

        const drag = this.dragState;
        const { world } = this.getCanvasEventData(event);
        this.dragState = null;

        if (drag.type === 'disc-placement') {
            if (drag.secondClick || drag.moved) {
                this.pendingDiscRadius = Math.max(5, MathUtils.distance(
                    drag.anchor.x,
                    drag.anchor.y,
                    world.x,
                    world.y
                ));
                this.openDiscModalForAdd();
            } else {
                this.updateStatus('Click again or drag to set disc radius.');
            }
            return;
        }

        if (drag.type === 'pencil-move' && !drag.moved) {
            return;
        }

        if (drag.type === 'context-pan') {
            if (drag.moved || !drag.menuTarget) {
                return;
            }

            this.pauseForEditing();
            if (drag.menuTarget.type === 'pencil-menu') {
                this.openPencilModal(drag.menuTarget.pencilId);
                return;
            }
            if (drag.menuTarget.type === 'disc-menu') {
                this.openDiscModalForEdit(drag.menuTarget.discId);
                return;
            }
            if (drag.menuTarget.type === 'stick-menu') {
                this.openStickMenu(drag.menuTarget.chainId, drag.menuTarget.stickIndex);
            }
            return;
        }
    }

    onCanvasWheel(event) {
        if (this.hasModalOpen()) return;
        event.preventDefault();
        const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.app.renderer.zoomAt(event.offsetX, event.offsetY, zoomFactor);
    }

    startDiscPlacement(world) {
        if (!this.pendingDiscStart) {
            this.pendingDiscStart = { ...world };
            this.pendingDiscRadius = 0;
            this.dragState = { type: 'disc-placement', anchor: { ...world }, moved: false, secondClick: false };
            this.updateStatus('Drag or click again to set disc radius.');
            return;
        }

        this.dragState = { type: 'disc-placement', anchor: { ...this.pendingDiscStart }, moved: false, secondClick: true };
    }

    createDiscAttachmentAtPoint(disc, world) {
        const dx = world.x - disc.x;
        const dy = world.y - disc.y;
        const distance = MathUtils.clamp(Math.hypot(dx, dy), 0, disc.radius);
        const angleOffset = Math.atan2(dy, dx) - disc.angle;
        return { type: 'disc', id: disc.id, distance, angleOffset };
    }

    openDiscModalForAdd() {
        this.discModalMode = 'add';
        this.editingDiscId = null;
        document.getElementById('modal-disc-title').textContent = 'Set Disc RPM';
        document.getElementById('input-disc-radius').value = this.pendingDiscRadius.toFixed(1);
        document.getElementById('input-disc-rpm').value = 60;
        document.getElementById('input-disc-torque').value = this.formatTorqueValue(AppConfig.SYSTEM_DEFAULTS.DISC_TORQUE);
        document.getElementById('btn-delete-disc').style.display = 'none';
        this.openModal('modal-disc');
    }

    openDiscModalForEdit(discId) {
        const disc = this.app.system.getDisc(discId);
        if (!disc) return;

        this.pauseForEditing();
        this.discModalMode = 'edit';
        this.editingDiscId = discId;
        document.getElementById('modal-disc-title').textContent = `Edit Disc ${disc.id}`;
        document.getElementById('input-disc-radius').value = disc.radius;
        document.getElementById('input-disc-rpm').value = disc.targetRpm;
        document.getElementById('input-disc-torque').value = this.formatTorqueValue(disc.torque);
        document.getElementById('btn-delete-disc').style.display = 'inline-flex';
        this.openModal('modal-disc');
    }

    confirmDisc() {
        const radius = Math.max(5, parseFloat(document.getElementById('input-disc-radius').value) || 30);
        const rpm = parseFloat(document.getElementById('input-disc-rpm').value) || 60;
        const torque = this.parseTorqueInput(document.getElementById('input-disc-torque').value);

        if (this.discModalMode === 'add' && this.pendingDiscStart) {
            this.app.system.addDisc(this.pendingDiscStart.x, this.pendingDiscStart.y, radius, rpm, torque);
            this.pendingDiscStart = null;
            this.pendingDiscRadius = 0;
            this.activateTool('disc');
        } else if (this.discModalMode === 'edit' && this.editingDiscId !== null) {
            const disc = this.app.system.getDisc(this.editingDiscId);
            if (disc) {
                disc.radius = radius;
                disc.setRpm(rpm);
                disc.setTorque(torque);
                if (!this.app.isPlaying) {
                    disc.restRpm = rpm;
                    disc.rampStartRpm = rpm;
                    disc.rpm = rpm;
                }
            }
        }

        this.closeDiscModal();
        this.refreshGeometry();
        this.updateStatus('Disc updated.');
    }

    closeDiscModal() {
        if (this.discModalMode === 'add') {
            this.pendingDiscStart = null;
            this.pendingDiscRadius = 0;
        }
        this.editingDiscId = null;
        document.getElementById('btn-delete-disc').style.display = 'none';
        this.closeModal('modal-disc');
        this.updateStatus();
    }

    deleteDisc() {
        if (this.editingDiscId === null) return;
        this.app.system.removeDisc(this.editingDiscId);
        this.closeDiscModal();
        this.refreshGeometry();
        this.updateStatus('Disc deleted.');
    }

    parseTorqueInput(rawValue) {
        const value = String(rawValue ?? '').trim().toLowerCase();
        if (!value || value === 'inf' || value === 'infinite' || value === 'infinity') {
            return AppConfig.SYSTEM_DEFAULTS.DISC_TORQUE;
        }

        const parsed = parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return AppConfig.SYSTEM_DEFAULTS.DISC_TORQUE;
        }

        return MathUtils.clamp(parsed, 0, 100);
    }

    formatTorqueValue(torque) {
        return Number.isFinite(torque) ? torque : 'infinite';
    }

    handleStickToolClick(world, canvasX, canvasY, hit) {
        if (!this.pendingStick) {
            if (!hit || (hit.type !== 'disc' && hit.type !== 'disc-center')) {
                this.updateStatus('Click on a disc to place the stick start.');
                return;
            }

            const disc = this.app.system.getDisc(hit.id);
            if (!disc) return;

            this.pendingStick = {
                mode: 'new',
                chainId: null,
                startAttachment: this.createDiscAttachmentAtPoint(disc, world),
                previewEnd: { ...world },
                previewAttachment: null
            };
            this.updateStatus('Click a second point to place the stick end.');
            return;
        }

        const preview = this.getStickPreviewForWorld(world, canvasX, canvasY, this.pendingStick.chainId);
        this.pendingStick.previewEnd = preview.end;
        this.pendingStick.previewAttachment = preview.attachment;
        this.commitPendingStick();
    }

    getStickPreviewForWorld(world, canvasX, canvasY, chainId = null) {
        const excludeStickIds = [];
        if (chainId !== null) {
            const chain = this.app.system.getStickChain(chainId);
            if (chain) {
                excludeStickIds.push(...chain.sticks.map(stick => stick.id));
            }
        }

        const hit = this.app.renderer.findStickAtCanvas(canvasX, canvasY, this.app.system, 10, { skipStickIds: excludeStickIds });
        if (hit) {
            const stick = this.app.system.getStickById(hit.id);
            const distance = stick ? hit.t * stick.restLength : 0;
            return {
                attachment: { type: 'anchor', id: hit.id, distance },
                end: hit.point,
                length: this.getPendingStickStartDistance(hit.point)
            };
        }

        return {
            attachment: { type: 'openEnd' },
            end: { ...world },
            length: this.getPendingStickStartDistance(world)
        };
    }

    getPendingStickStartDistance(endPoint) {
        const preview = this.getPendingStickPreview();
        if (!preview) return 0;
        return MathUtils.distance(preview.start.x, preview.start.y, endPoint.x, endPoint.y);
    }

    getPendingStickPreview() {
        if (!this.pendingStick) return null;

        if (this.pendingStick.mode === 'new') {
            return {
                start: this.app.solver.getAttachmentPosition(this.pendingStick.startAttachment),
                end: this.pendingStick.previewEnd || this.app.solver.getAttachmentPosition(this.pendingStick.startAttachment)
            };
        }

        const chain = this.app.system.getStickChain(this.pendingStick.chainId);
        if (!chain || chain.sticks.length === 0) return null;
        const lastStick = chain.sticks[chain.sticks.length - 1];
        return {
            start: { x: lastStick.endX, y: lastStick.endY },
            end: this.pendingStick.previewEnd || { x: lastStick.endX, y: lastStick.endY }
        };
    }

    commitPendingStick() {
        if (!this.pendingStick) return;

        const preview = this.getPendingStickPreview();
        if (!preview) return;

        let chain;
        let startPos = preview.start;

        if (this.pendingStick.mode === 'new') {
            chain = this.app.system.addStickChain();
            chain.startAttachment = { ...this.pendingStick.startAttachment };
        } else {
            chain = this.app.system.getStickChain(this.pendingStick.chainId);
            if (!chain) return;
            const lastStick = chain.sticks[chain.sticks.length - 1];
            startPos = { x: lastStick.endX, y: lastStick.endY };
        }

        const endPos = this.pendingStick.previewEnd;
        const length = Math.max(1, MathUtils.distance(startPos.x, startPos.y, endPos.x, endPos.y));
        const angle = MathUtils.angleToPoint(startPos.x, startPos.y, endPos.x, endPos.y);
        const stick = new Stick(this.app.system.nextStickId(), length, AppConfig.SYSTEM_DEFAULTS.STICK_STIFFNESS);
        stick.setPosition(startPos.x, startPos.y, angle);
        chain.addStick(stick);
        chain.endAttachment = { ...this.pendingStick.previewAttachment };

        this.pendingStick = null;
        this.activateTool('stick');
        this.refreshGeometry();
        this.updateStatus('Stick added.');
    }

    openStickMenu(chainId, stickIndex) {
        this.editingStickTarget = { chainId, stickIndex };
        const chain = this.app.system.getStickChain(chainId);
        const stick = chain?.getStick(stickIndex) || null;
        const isLast = chain ? stickIndex === chain.sticks.length - 1 : false;
        document.getElementById('stick-menu-title').textContent = `Stick ${stickIndex + 1} Actions`;
        document.getElementById('input-stick-stiffness').value = stick
            ? AppConfig.clampStickStiffnessPercent(stick.stiffness)
            : AppConfig.SYSTEM_DEFAULTS.STICK_STIFFNESS;
        document.getElementById('btn-add-next-stick').disabled = !isLast;
        document.getElementById('stick-menu-note').textContent = isLast
            ? 'You can update this segment stiffness percentage, delete the stick, or append another stick to the chain.'
            : 'You can update this segment stiffness percentage or delete the stick. Only the last stick in a chain can receive a new next stick.';
        this.openModal('modal-stick');
    }

    closeStickMenu() {
        this.editingStickTarget = null;
        this.closeModal('modal-stick');
    }

    startAppendStick() {
        if (!this.editingStickTarget) return;
        const chain = this.app.system.getStickChain(this.editingStickTarget.chainId);
        if (!chain || this.editingStickTarget.stickIndex !== chain.sticks.length - 1) return;

        const lastStick = chain.sticks[chain.sticks.length - 1];
        this.closeStickMenu();
        this.activeTool = 'stick';
        document.getElementById('tool-stick').classList.add('active');
        document.getElementById('tool-disc').classList.remove('active');
        document.getElementById('tool-anchor').classList.remove('active');
        document.getElementById('tool-pencil').classList.remove('active');
        this.pendingStick = {
            mode: 'append',
            chainId: chain.id,
            previewEnd: { x: lastStick.endX + 80, y: lastStick.endY },
            previewAttachment: { type: 'openEnd' }
        };
        this.updateStatus('Click to place the next stick end.');
    }

    saveStickSettings() {
        if (!this.editingStickTarget) return;
        const chainId = this.editingStickTarget.chainId;
        const stickIndex = this.editingStickTarget.stickIndex;
        const chain = this.app.system.getStickChain(chainId);
        const stick = chain?.getStick(stickIndex) || null;
        if (!stick) return;

        stick.stiffness = AppConfig.clampStickStiffnessPercent(
            parseFloat(document.getElementById('input-stick-stiffness').value) || 0
        );
        this.closeStickMenu();
        this.refreshGeometry();
        this.updateStatus(`Stick ${stickIndex + 1} updated.`);
    }

    deleteStick() {
        if (!this.editingStickTarget) return;
        this.app.system.removeStick(this.editingStickTarget.chainId, this.editingStickTarget.stickIndex);
        this.closeStickMenu();
        this.refreshGeometry();
        this.updateStatus('Stick deleted.');
    }

    handlePencilToolClick(canvasX, canvasY) {
        const hit = this.app.renderer.findStickAtCanvas(canvasX, canvasY, this.app.system, 10);
        if (!hit) {
            this.updateStatus('Click on a stick to place a pencil.');
            return;
        }

        const stick = this.app.system.getStickById(hit.id);
        if (!stick) return;

        const pencil = this.app.system.addPencil(
            hit.chainId,
            hit.stickIndex,
            hit.t * stick.restLength,
            '#00ff00',
            3
        );
        this.activateTool('pencil');
        this.refreshGeometry();
        this.updateStatus(`Pencil ${pencil.id} added.`);
    }

    handleAnchorToolClick(world, canvasX, canvasY) {
        const definition = this.getAnchorDefinitionForCanvas(canvasX, canvasY, world);
        if (!definition) {
            this.updateStatus('Anchor must be placed on an existing stick segment.');
            return;
        }

        const anchor = this.app.system.addAnchor(definition.primaryAttachment, definition.targetAttachment);
        this.activateTool('anchor');
        this.refreshGeometry();
        this.updateStatus(`Anchor ${anchor.id} added.`);
    }

    getAnchorDefinitionForCanvas(canvasX, canvasY, world) {
        const locus = this.findAnchorLocus(canvasX, canvasY);
        if (!locus) return null;

        return {
            primaryAttachment: {
                type: 'stick',
                id: locus.primary.id,
                distance: locus.primary.distance
            },
            targetAttachment: this.resolveAnchorTargetAttachment(locus, world)
        };
    }

    findAnchorLocus(canvasX, canvasY) {
        const tolerance = 10;
        const hits = [];

        for (const chain of this.app.system.stickChains) {
            for (let i = 0; i < chain.sticks.length; i++) {
                const stick = chain.sticks[i];
                const startPos = this.app.renderer.worldToCanvas(stick.startX, stick.startY);
                const endPos = this.app.renderer.worldToCanvas(stick.endX, stick.endY);
                const projection = this.app.renderer.projectPointOntoSegment(
                    canvasX,
                    canvasY,
                    startPos.x,
                    startPos.y,
                    endPos.x,
                    endPos.y
                );

                if (projection.distance <= tolerance) {
                    hits.push({
                        id: stick.id,
                        chainId: chain.id,
                        stickIndex: i,
                        distance: projection.t * stick.restLength,
                        point: this.app.renderer.canvasToWorld(projection.x, projection.y)
                    });
                }
            }
        }

        if (hits.length === 0) return null;
        return { primary: hits[0], allStickHits: hits };
    }

    resolveAnchorTargetAttachment(locus, world) {
        const secondaryStick = locus.allStickHits.find(hit => hit.id !== locus.primary.id);
        if (secondaryStick) {
            return {
                type: 'anchor',
                id: secondaryStick.id,
                distance: secondaryStick.distance
            };
        }

        for (const disc of this.app.system.discs) {
            const distance = MathUtils.distance(disc.x, disc.y, locus.primary.point.x, locus.primary.point.y);
            if (distance <= disc.radius + 1e-6) {
                return this.createDiscAttachmentAtPoint(disc, locus.primary.point);
            }
        }

        return { type: 'anchor', x: locus.primary.point.x, y: locus.primary.point.y };
    }

    openPencilModal(pencilId) {
        const pencil = this.app.system.getPencil(pencilId);
        if (!pencil) return;

        this.pauseForEditing();
        this.editingPencilId = pencilId;
        document.getElementById('modal-pencil-title').textContent = `Edit Pencil ${pencil.id}`;
        document.getElementById('input-pencil-duration').value = pencil.persistenceDuration;
        document.getElementById('input-pencil-color').value = pencil.color;
        document.getElementById('btn-delete-pencil').style.display = 'inline-flex';
        this.openModal('modal-pencil');
    }

    confirmPencil() {
        if (this.editingPencilId === null) return;
        const pencil = this.app.system.getPencil(this.editingPencilId);
        if (!pencil) return;

        pencil.color = document.getElementById('input-pencil-color').value || pencil.color;
        pencil.persistenceDuration = parseFloat(document.getElementById('input-pencil-duration').value) || pencil.persistenceDuration;
        this.closePencilModal();
        this.refreshGeometry();
        this.updateStatus('Pencil updated.');
    }

    closePencilModal() {
        this.editingPencilId = null;
        document.getElementById('btn-delete-pencil').style.display = 'none';
        this.closeModal('modal-pencil');
        this.updateStatus();
    }

    deletePencil() {
        if (this.editingPencilId === null) return;
        this.app.system.removePencil(this.editingPencilId);
        this.closePencilModal();
        this.refreshGeometry();
        this.updateStatus('Pencil deleted.');
    }

    movePencilToCanvas(pencilId, canvasX, canvasY) {
        const pencil = this.app.system.getPencil(pencilId);
        if (!pencil) return;

        const hit = this.app.renderer.findStickAtCanvas(canvasX, canvasY, this.app.system, 12);
        if (!hit) return;

        const stick = this.app.system.getStickById(hit.id);
        if (!stick) return;

        pencil.stickChainId = hit.chainId;
        pencil.stickIndex = hit.stickIndex;
        pencil.positionOnStick = hit.t * stick.restLength;
        this.refreshGeometry();
    }

    moveStickStartToWorld(chainId, world, canvasX, canvasY) {
        const chain = this.app.system.getStickChain(chainId);
        if (!chain || !chain.startAttachment || chain.startAttachment.type !== 'disc') return;

        let disc = this.app.system.getDisc(chain.startAttachment.id);
        const hit = this.app.renderer.hitTest(canvasX, canvasY, this.app.system, 10);
        if (hit?.type === 'disc' || hit?.type === 'disc-center') {
            disc = this.app.system.getDisc(hit.id);
        }
        if (!disc) return;

        chain.startAttachment = this.createDiscAttachmentAtPoint(disc, world);
        this.refreshGeometry();
    }

    moveStickEndToWorld(chainId, world, canvasX, canvasY) {
        const chain = this.app.system.getStickChain(chainId);
        if (!chain || chain.sticks.length === 0) return;

        const preview = this.getStickPreviewForWorld(world, canvasX, canvasY, chainId);
        chain.endAttachment = { ...preview.attachment };
        const lastStick = chain.sticks[chain.sticks.length - 1];
        if (lastStick) {
            lastStick.angle = MathUtils.angleToPoint(lastStick.startX, lastStick.startY, preview.end.x, preview.end.y);
        }
        this.refreshGeometry();
    }

    refreshGeometry() {
        const validation = this.app.system.validate();
        if (validation.valid) {
            const result = this.app.solver.solve();
            this.app.lastSolveResult = result;
            if (!result.success) {
                this.app.solver.updatePencilPositions();
            }
            return;
        }

        this.app.solver.updatePencilPositions();
    }

    validateSystem() {
        this.refreshGeometry();
        const validation = this.app.system.validate();
        const driveAnalysis = this.app.system.analyzeDiscDrives();
        const message = driveAnalysis.warnings.length > 0
            ? `${validation.message} ${driveAnalysis.warnings[0]}`
            : validation.message;
        this.updateStatus(message);
    }

    clearSystem() {
        this.pauseForEditing();
        if (confirm('Clear entire system? This cannot be undone.')) {
            this.app.system.clear();
            this.cancelPendingConstruction();
            this.activateTool(null);
            this.updateStatus('System cleared.');
        }
    }

    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }

    updateStatus(message = null) {
        if (!message) {
            message = this.app.system.getStatus();
            if (this.activeTool) {
                message += ` [${this.activeTool.toUpperCase()} tool active]`;
            }
        }

        document.getElementById('status-message').textContent = message;
        document.getElementById('status-discs').textContent = this.app.system.discs.length;
        document.getElementById('status-chains').textContent = this.app.system.stickChains.length;
        document.getElementById('status-pencils').textContent = this.app.system.pencils.length;
    }
}
