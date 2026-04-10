/**
 * Main Application: Orchestrates the kinematic visualizer
 */
class App {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.system = new System();
        this.renderer = new CanvasRenderer(this.canvas);
        this.solverMode = 'hybrid';
        this.solver = this.createSolver(this.solverMode);
        this.drawingTools = new DrawingTools(this);
        this.playbackControls = new PlaybackControls(this);

        this.isPlaying = false;
        this.startTime = null;
        this.pauseTime = null;
        this.timeScale = 1;
        this.lastFrameTime = 0;
        this.fixedStepMs = AppConfig.GENERAL_SIMULATION.FIXED_STEP_MS;
        this.initialSystem = null;
        this.showMechanics = true;
        this.lastSolveResult = null;

        this.setupEventListeners();
        this.startAnimationLoop();
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
        window.addEventListener('contextmenu', event => event.preventDefault());
        document.getElementById('btn-print').addEventListener('click', () => this.printSystemConfiguration());
        
        //document.getElementById('btn-load-test').addEventListener('click', () => this.loadDebugTestConfiguration());
        document.getElementById('btn-load-test').addEventListener('click', () => this.testLandscapeLoader());
        
        document.getElementById('btn-toggle-solver').addEventListener('click', () => this.toggleSolverMode());
        this.onWindowResize();
        this.drawingTools.refreshGeometry();
        this.playbackControls.syncSidebar();
        this.syncSolverToggleButton();
    }

    createSolver(mode) {
        if (mode === 'kinematic') {
            return new KinematicSolver(this.system);
        }
        if (mode === 'energy') {
            return new EnergySolver(this.system);
        }
        return new HybridSolver(this.system);
    }

    getSolverDisplayName(mode = this.solverMode) {
        if (mode === 'kinematic') return 'Kinematic';
        if (mode === 'energy') return 'Energy';
        return 'Hybrid';
    }

    getSolverModes() {
        return ['hybrid', 'energy', 'kinematic'];
    }

    syncSolverToggleButton() {
        const button = document.getElementById('btn-toggle-solver');
        if (!button) return;

        const modes = this.getSolverModes();
        const currentName = this.getSolverDisplayName();
        const nextMode = modes[(modes.indexOf(this.solverMode) + 1) % modes.length];
        const nextName = this.getSolverDisplayName(nextMode);
        button.innerHTML = `<strong>Solver: ${currentName}</strong><span>Next: ${nextName}</span>`;
    }

    toggleSolverMode() {
        const modes = this.getSolverModes();
        const nextMode = modes[(modes.indexOf(this.solverMode) + 1) % modes.length];
        this.setSolverMode(nextMode);
    }

    setSolverMode(mode) {
        if (!this.getSolverModes().includes(mode)) return;

        this.pauseForEditing();
        this.solverMode = mode;
        this.solver = this.createSolver(mode);
        this.lastSolveResult = null;
        this.drawingTools.refreshGeometry();
        this.playbackControls.syncSidebar();
        this.syncSolverToggleButton();
        this.drawingTools.updateStatus(`${this.getSolverDisplayName()}Solver active.`);
    }

    onWindowResize() {
        const canvasArea = document.querySelector('.canvas-area');
        this.renderer.resize(canvasArea.clientWidth, canvasArea.clientHeight);
    }

    pauseForEditing() {
        if (this.isPlaying) {
            this.playbackControls.pause();
        }
    }

    getElapsedTime() {
        if (!this.isPlaying && !this.startTime) return 0;
        if (this.pauseTime !== null) return this.pauseTime;

        const now = performance.now();
        if (!this.startTime) {
            this.startTime = now;
        }
        return (now - this.startTime) / 1000;
    }

    startAnimationLoop() {
        const loop = () => {
            this.update();
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    update() {
        const now = performance.now();
        const dt = this.lastFrameTime ? now - this.lastFrameTime : 0;
        this.lastFrameTime = now;

        if (!this.isPlaying) {
            this.system.simTime = this.getElapsedTime();
            this.playbackControls.syncSidebar();
            this.drawingTools.updateStatus();
            return;
        }

        this.advanceSimulation(dt, { useDiscUpdate: true, recordTrace: true, reverseTraceCleanup: false });
        this.playbackControls.syncSidebar();
    }

    advanceSimulation(dtMs, options = {}) {
        const {
            useDiscUpdate = false,
            recordTrace = true,
            reverseTraceCleanup = dtMs < 0
        } = options;

        if (!Number.isFinite(dtMs) || dtMs === 0) {
            const currentTime = this.system.simTime || 0;
            this.playbackControls.updateTimeDisplay(currentTime);
            return currentTime;
        }

        this.advanceDiscAngles(dtMs, useDiscUpdate);
        this.system.syncAttachedRotatingBodies();

        const result = this.solver.solve({ dtMs, timeScale: this.timeScale });
        this.lastSolveResult = result;
        if (!result.success) {
            console.warn('Solver warning:', result.error);
            this.drawingTools.refreshGeometry();
        } else {
            this.solver.updatePencilPositions();
        }

        const nextTime = Math.max(0, (this.system.simTime || 0) + (dtMs / 1000));
        this.system.simTime = nextTime;

        for (const pencil of this.system.pencils) {
            if (reverseTraceCleanup) {
                pencil.traces = pencil.traces.filter(trace => trace.timestamp <= nextTime);
            }

            pencil.x = Number.isFinite(pencil.x) ? pencil.x : 0;
            pencil.y = Number.isFinite(pencil.y) ? pencil.y : 0;

            if (recordTrace) {
                const tracePoint = { x: pencil.x, y: pencil.y };
                const screen = this.system.getScreenAtPoint(tracePoint);
                if (screen) {
                    const localPoint = screen.worldToLocal(tracePoint);
                    pencil.updatePosition(pencil.x, pencil.y, nextTime, {
                        screenId: screen.id,
                        localX: localPoint.x,
                        localY: localPoint.y
                    });
                }
            } else {
                pencil.cleanupTraces(nextTime);
            }

            pencil.cleanupTraces(nextTime);
        }

        this.playbackControls.updateTimeDisplay(nextTime);
        return nextTime;
    }

    advanceDiscAngles(dtMs, useDiscUpdate = false) {
        if (this.solverMode === 'hybrid') {
            for (const disc of this.system.getRotatingBodies()) {
                disc.updateDriveTarget(dtMs, this.timeScale);
                if (disc.isHardDriven()) {
                    disc.angle = ((disc.angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
                }
            }
            return;
        }

        for (const disc of this.system.getRotatingBodies()) {
            if (useDiscUpdate && dtMs > 0) {
                disc.update(dtMs, this.timeScale);
                continue;
            }

            const radsPerMs = (disc.rpm / 60) * 2 * Math.PI / 1000;
            disc.angle += radsPerMs * dtMs * this.timeScale;
            disc.angle = ((disc.angle % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
        }
    }

    stepSimulation(direction) {
        if (direction !== 1 && direction !== -1) return;

        if (this.isPlaying) {
            this.playbackControls.pause();
        }

        let stepMs = direction * this.fixedStepMs;
        if (direction < 0) {
            const maxBackwardMs = (this.system.simTime || 0) * 1000;
            stepMs = -Math.min(this.fixedStepMs, maxBackwardMs);
            if (stepMs === 0) {
                this.playbackControls.updateTimeDisplay(this.system.simTime || 0);
                return;
            }
        }

        const steppedTime = this.advanceSimulation(stepMs, {
            useDiscUpdate: false,
            recordTrace: direction > 0,
            reverseTraceCleanup: direction < 0
        });

        this.pauseTime = steppedTime;
        this.startTime = performance.now() - (steppedTime * 1000);
        this.lastFrameTime = performance.now();
        this.drawingTools.updateStatus();
    }

    render() {
        this.system.syncAttachedRotatingBodies();
        this.renderer.render(this.system, { showMechanics: this.showMechanics });

        if (this.showMechanics && this.drawingTools.pendingDiscStart) {
            this.renderer.drawPendingDisc(
                this.drawingTools.pendingDiscStart.x,
                this.drawingTools.pendingDiscStart.y,
                this.drawingTools.pendingDiscRadius
            );
        }

        if (this.showMechanics && this.drawingTools.pendingStick) {
            const preview = this.drawingTools.getPendingStickPreview();
            if (preview) {
                this.renderer.drawPendingStick(preview.start.x, preview.start.y, preview.end.x, preview.end.y);
            }
        }
    }

    resetPlaybackState() {
        this.isPlaying = false;
        this.startTime = performance.now();
        this.pauseTime = null;
        this.lastFrameTime = 0;
        this.system.simTime = 0;
        if (this.solver.lastSolvedNodePositions) {
            this.solver.lastSolvedNodePositions.clear();
        }
        if (this.solver.lastSolvedAngles) {
            this.solver.lastSolvedAngles.clear();
        }
        if (this.solver.lastSolvedDiscAngles) {
            this.solver.lastSolvedDiscAngles.clear();
        }
        if (this.solver.dynamicNodeState) {
            this.solver.dynamicNodeState.clear();
        }
        if (this.solver.dynamicDiscState) {
            this.solver.dynamicDiscState.clear();
        }
        if (this.solver.constraintLambdaState) {
            this.solver.constraintLambdaState.clear();
        }
        if (this.solver.bendingRestState) {
            this.solver.bendingRestState.clear();
        }
        document.getElementById('time-display').textContent = '0.00s';
    }

    roundValue(value) {
        return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
    }

    roundPoint(point) {
        if (!point) return null;
        return {
            x: this.roundValue(point.x),
            y: this.roundValue(point.y)
        };
    }

    buildSystemConfigurationExport() {
        this.system.syncAttachedRotatingBodies();
        this.drawingTools.refreshGeometry();

        return {
            simTime: this.roundValue(this.system.simTime || 0),
            solver: this.solver.constructor.name,
            lastSolveResult: this.lastSolveResult ? {
                success: this.lastSolveResult.success,
                error: this.lastSolveResult.error,
                residualNorm: this.roundValue(this.lastSolveResult.residualNorm),
                energy: this.roundValue(this.lastSolveResult.energy),
                iterationCount: this.lastSolveResult.iterationCount,
                warnings: this.lastSolveResult.warnings || []
            } : null,
            validation: this.system.validate(),
            constraintAnalysis: this.system.analyzeConstraints(),
            driveAnalysis: this.system.analyzeDiscDrives(),
            discs: this.system.discs.map(disc => ({
                id: disc.id,
                kind: disc.kind,
                center: this.roundPoint({ x: disc.x, y: disc.y }),
                radius: this.roundValue(disc.radius),
                rpm: this.roundValue(disc.rpm),
                restRpm: this.roundValue(disc.restRpm),
                targetRpm: this.roundValue(disc.targetRpm),
                torque: Number.isFinite(disc.torque) ? this.roundValue(disc.torque) : 'infinite',
                color: disc.color || null,
                centerAttachment: disc.centerAttachment ? { ...disc.centerAttachment } : null,
                transparencyMode: Boolean(disc.transparencyMode),
                driveMode: disc.getDriveMode(),
                legacyDriveBehavior: disc.getLegacyDriveBehavior(),
                angle: this.roundValue(disc.angle)
            })),
            screens: this.system.screens.map(screen => ({
                id: screen.id,
                kind: screen.kind,
                center: this.roundPoint({ x: screen.x, y: screen.y }),
                radius: this.roundValue(screen.radius),
                rpm: this.roundValue(screen.rpm),
                restRpm: this.roundValue(screen.restRpm),
                targetRpm: this.roundValue(screen.targetRpm),
                torque: Number.isFinite(screen.torque) ? this.roundValue(screen.torque) : 'infinite',
                color: screen.color || null,
                centerAttachment: screen.centerAttachment ? { ...screen.centerAttachment } : null,
                transparencyMode: Boolean(screen.transparencyMode),
                driveMode: screen.getDriveMode(),
                legacyDriveBehavior: screen.getLegacyDriveBehavior(),
                angle: this.roundValue(screen.angle)
            })),
            chains: this.system.stickChains.map(chain => {
                const nodes = [];
                if (chain.startAttachment) {
                    nodes.push({
                        kind: 'start',
                        point: this.roundPoint(this.solver.getAttachmentPosition(chain.startAttachment))
                    });
                }

                for (let i = 0; i < chain.sticks.length; i++) {
                    const stick = chain.sticks[i];
                    nodes.push({
                        kind: i === chain.sticks.length - 1 ? 'end' : `joint_${i + 1}`,
                        point: this.roundPoint(stick.getEndPoint())
                    });
                }

                const anchors = [];
                const endType = this.system.getAttachmentType(chain.endAttachment);
                if (endType === 'anchor' || endType === 'fixedPoint') {
                    anchors.push({
                        type: endType,
                        point: this.roundPoint(this.solver.getAttachmentPosition(chain.endAttachment)),
                        hostStickId: endType === 'anchor' ? chain.endAttachment.id : null,
                        distanceOnHost: endType === 'anchor' ? this.roundValue(chain.endAttachment.distance) : null
                    });
                }

                return {
                    id: chain.id,
                    startAttachment: chain.startAttachment ? {
                        ...chain.startAttachment,
                        normalizedType: this.system.getAttachmentType(chain.startAttachment),
                        distance: this.roundValue(chain.startAttachment.distance),
                        angleOffset: this.roundValue(chain.startAttachment.angleOffset)
                    } : null,
                    endAttachment: chain.endAttachment ? {
                        ...chain.endAttachment,
                        normalizedType: endType,
                        distance: this.roundValue(chain.endAttachment.distance),
                        x: this.roundValue(chain.endAttachment.x),
                        y: this.roundValue(chain.endAttachment.y)
                    } : null,
                    sticks: chain.sticks.map(stick => ({
                        id: stick.id,
                        restLength: this.roundValue(stick.restLength),
                        actualLength: this.roundValue(stick.actualLength),
                        stiffness: this.roundValue(stick.stiffness),
                        angle: this.roundValue(stick.angle),
                        start: this.roundPoint({ x: stick.startX, y: stick.startY }),
                        end: this.roundPoint({ x: stick.endX, y: stick.endY }),
                        slider: stick.slider ? {
                            id: stick.slider.id,
                            distance: this.roundValue(stick.slider.distance),
                            target: this.roundPoint({ x: stick.slider.x, y: stick.slider.y })
                        } : null
                    })),
                    nodes,
                    anchors
                };
            }),
            manualAnchors: this.system.anchors.map(anchor => ({
                id: anchor.id,
                primaryAttachment: anchor.primaryAttachment ? {
                    ...anchor.primaryAttachment,
                    distance: this.roundValue(anchor.primaryAttachment.distance)
                } : null,
                targetAttachment: anchor.targetAttachment ? {
                    ...anchor.targetAttachment,
                    normalizedType: this.system.getAttachmentType(anchor.targetAttachment),
                    distance: this.roundValue(anchor.targetAttachment.distance),
                    angleOffset: this.roundValue(anchor.targetAttachment.angleOffset),
                    x: this.roundValue(anchor.targetAttachment.x),
                    y: this.roundValue(anchor.targetAttachment.y)
                } : null,
                point: this.roundPoint(this.solver.getAnchorPrimaryPosition(anchor))
            })),
            sliders: this.system.sliders.map(slider => ({
                id: slider.id,
                stickId: slider.stickId,
                distance: this.roundValue(slider.distance),
                target: this.roundPoint({ x: slider.x, y: slider.y })
            })),
            pencils: this.system.pencils.map(pencil => ({
                id: pencil.id,
                stickChainId: pencil.stickChainId,
                stickIndex: pencil.stickIndex,
                positionOnStick: this.roundValue(pencil.positionOnStick),
                point: this.roundPoint({ x: pencil.x, y: pencil.y })
            }))
        };
    }

    printSystemConfiguration() {
        const dump = this.buildSystemConfigurationExport();
        const json = JSON.stringify(dump, null, 2);

        console.groupCollapsed('[Export] System configuration JSON');
        console.log(json);
        console.groupEnd();
        this.drawingTools.updateStatus('System configuration exported as JSON in the console.');
    }


    testLandscapeLoader() {
        // TODO
        this.drawingTools.updateStatus('Loading test landscape...');
        this.resetPlaybackState();
        this.system.clear();
        const LP = AppConfig.TEST_LANDSCAPE;
        LP.discs.forEach(el => {
            const disc = this.system.addDisc(el.x, el.y, el.r, el.rpm);
        });
        LP.screens.forEach(el => {
            const screen = this.system.addScreen(el.x, el.y, el.r, el.rpm);
        });
        this.drawingTools.cancelPendingConstruction();
        this.drawingTools.refreshGeometry();
        this.playbackControls.syncSidebar();
        this.drawingTools.updateStatus('Test Landscape loaded.');
        this.printSystemConfiguration();
    };

    loadDebugTestConfiguration() {
        this.drawingTools.updateStatus('Loading debug test setup...');
        this.resetPlaybackState();
        this.system.clear();

        const disc1 = this.system.addDisc(0, 0, 80, 30);
        const disc2 = this.system.addDisc(-400, 100, 80, 60);
        disc1.angle = 0;
        disc2.angle = 0;
        disc1.driveTargetAngle = 0;
        disc2.driveTargetAngle = 0;
        disc1.targetRpm = 30;
        disc2.targetRpm = 60;
        disc1.restRpm = 30;
        disc2.restRpm = 60;
        disc1.rpm = 30;
        disc2.rpm = 60;

        const chain1 = this.system.addStickChain(disc1);
        const chain2 = this.system.addStickChain(disc2);

        const segment1Start = { x: 60, y: 0 };
        const segment1End = { x: -300, y: -200 };
        const segment2Start = { x: -340, y: 100 };
        const anchorPoint = {
            x: (segment1Start.x + segment1End.x) / 2,
            y: (segment1Start.y + segment1End.y) / 2
        };

        chain1.startAttachment = { type: 'disc', id: disc1.id, distance: 60, angleOffset: 0 };
        chain2.startAttachment = { type: 'disc', id: disc2.id, distance: 60, angleOffset: 0 };

        const stick1 = new Stick(
            this.system.nextStickId(),
            MathUtils.distance(segment1Start.x, segment1Start.y, segment1End.x, segment1End.y)
        );
        stick1.setPosition(
            segment1Start.x,
            segment1Start.y,
            MathUtils.angleToPoint(segment1Start.x, segment1Start.y, segment1End.x, segment1End.y)
        );
        chain1.addStick(stick1);

        const stick2 = new Stick(
            this.system.nextStickId(),
            MathUtils.distance(segment2Start.x, segment2Start.y, anchorPoint.x, anchorPoint.y)
        );
        stick2.setPosition(
            segment2Start.x,
            segment2Start.y,
            MathUtils.angleToPoint(segment2Start.x, segment2Start.y, anchorPoint.x, anchorPoint.y)
        );
        chain2.addStick(stick2);
        chain2.endAttachment = { type: 'anchor', id: stick1.id, distance: stick1.restLength / 2 };

        chain1.endAttachment = { type: 'openEnd' };

        this.drawingTools.cancelPendingConstruction();
        this.drawingTools.refreshGeometry();
        this.playbackControls.syncSidebar();
        this.drawingTools.updateStatus('Debug test setup loaded.');
        this.printSystemConfiguration();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log(`[App Reload] Now: ${new Date().toISOString()}`);
    window.app = new App();
});
