/**
 * PlaybackControls: UI for playback and parameter tuning
 */
class PlaybackControls {
    constructor(app) {
        this.app = app;
        this.rpmContainer = document.getElementById('disc-rpm-controls');
        this.setupEventListeners();
        this.renderDiscRpmControls();
        this.syncPlaybackButtons();
    }

    setupEventListeners() {
        this.bindClick('btn-step-backward', () => this.stepBackward());
        this.bindClick('btn-system-step-backward', () => this.stepBackward());
        this.bindClick('btn-play-toggle', () => this.togglePlayback());
        this.bindClick('btn-play', () => this.play());
        this.bindClick('btn-pause', () => this.pause());
        this.bindClick('btn-reset', () => this.reset());
        this.bindClick('btn-step-forward', () => this.stepForward());
        this.bindClick('btn-system-step-forward', () => this.stepForward());
        this.bindClick('btn-clear-traces', () => this.clearTraces());
        this.bindClick('btn-toggle-mechanics', () => this.toggleMechanicsVisibility());
        this.bindClick('btn-system-play-toggle', () => this.togglePlayback());
        this.bindClick('btn-system-play', () => this.play());
        this.bindClick('btn-system-pause', () => this.pause());
        const speedSlider = document.getElementById('speed-slider');
        if (speedSlider) {
            speedSlider.addEventListener('input', event => this.onSpeedChange(event));
        }
        if (this.rpmContainer) {
            this.rpmContainer.addEventListener('input', event => this.onDiscRpmInput(event));
        }
    }

    bindClick(id, handler) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', handler);
        }
    }

    togglePlayback() {
        if (this.app.isPlaying) {
            this.pause();
            return;
        }
        this.play();
    }

    play() {
        const validation = this.app.system.validate();
        if (!validation.valid) {
            alert('Cannot play: ' + validation.message);
            return;
        }

        const driveAnalysis = this.app.system.analyzeDiscDrives();

        const now = performance.now();
        if (this.app.pauseTime !== null) {
            this.app.startTime = now - this.app.pauseTime * 1000;
        } else if (!this.app.startTime) {
            this.app.startTime = now;
        }

        this.app.lastFrameTime = now;
        this.app.isPlaying = true;
        this.app.pauseTime = null;
        this.syncPlaybackButtons();

        if (driveAnalysis.warnings.length > 0) {
            this.app.drawingTools.updateStatus(driveAnalysis.warnings[0]);
        }
    }

    pause() {
        this.app.pauseTime = this.app.getElapsedTime();
        this.app.isPlaying = false;
        this.syncPlaybackButtons();
    }

    stepForward() {
        this.app.stepSimulation(1);
        this.syncSidebar();
    }

    stepBackward() {
        this.app.stepSimulation(-1);
        this.syncSidebar();
    }

    reset() {
        this.app.isPlaying = false;
        this.app.pauseTime = null;
        this.app.startTime = performance.now();
        this.app.system.simTime = 0;

        for (const disc of this.app.system.discs) {
            disc.angle = 0;
            disc.driveTargetAngle = 0;
            disc.restRpm = disc.targetRpm;
            disc.rampStartRpm = disc.targetRpm;
            disc.rpm = disc.targetRpm;
        }
        for (const pencil of this.app.system.pencils) {
            pencil.clearTraces();
        }

        this.app.drawingTools.refreshGeometry();
        this.syncPlaybackButtons();
        this.syncDiscRpmControls();
        const timeDisplay = document.getElementById('time-display');
        if (timeDisplay) {
            timeDisplay.textContent = '0.00s';
        }
    }

    clearTraces() {
        for (const pencil of this.app.system.pencils) {
            pencil.clearTraces();
        }
    }

    toggleMechanicsVisibility() {
        this.app.showMechanics = !this.app.showMechanics;
        this.syncVisibilityButton();
    }

    onSpeedChange(event) {
        this.app.timeScale = parseFloat(event.target.value);
        const speedValue = document.getElementById('speed-value');
        if (speedValue) {
            speedValue.textContent = this.app.timeScale.toFixed(1) + 'x';
        }
    }

    updateTimeDisplay(elapsedSeconds) {
        const timeDisplay = document.getElementById('time-display');
        if (timeDisplay) {
            timeDisplay.textContent = elapsedSeconds.toFixed(2) + 's';
        }
    }

    syncPlaybackButtons() {
        const playing = this.app.isPlaying;

        const mainToggle = document.getElementById('btn-play-toggle');
        const sideToggle = document.getElementById('btn-system-play-toggle');
        if (mainToggle) {
            mainToggle.textContent = playing ? 'Pause' : 'Play';
        }
        if (sideToggle) {
            sideToggle.textContent = playing ? 'Pause' : 'Play';
        }

        const toolDisc = document.getElementById('tool-disc');
        const toolScreen = document.getElementById('tool-screen');
        const toolStick = document.getElementById('tool-stick');
        const toolPencil = document.getElementById('tool-pencil');
        if (toolDisc) toolDisc.disabled = playing;
        if (toolScreen) toolScreen.disabled = playing;
        if (toolStick) toolStick.disabled = playing;
        if (toolPencil) toolPencil.disabled = playing;
    }

    syncVisibilityButton() {
        const button = document.getElementById('btn-toggle-mechanics');
        if (button) {
            button.textContent = this.app.showMechanics ? 'Hide Mechanics' : 'Show Mechanics';
        }
    }

    renderDiscRpmControls() {
        if (!this.rpmContainer) return;

        const discs = this.getRpmControlledDiscs();
        if (discs.length === 0) {
            this.rpmContainer.innerHTML = '<div class="disc-rpm-empty">Add discs or screens to create live RPM controls.</div>';
            return;
        }

        this.rpmContainer.innerHTML = discs.map(disc => `
            <div class="disc-rpm-row" data-disc-id="${disc.id}">
                <div class="disc-rpm-header">
                    <span>${this.getDiscLabel(disc)} ${disc.id}</span>
                    <span id="disc-rpm-value-${disc.id}">${disc.targetRpm.toFixed(0)} rpm</span>
                </div>
                <div class="disc-rpm-empty" id="disc-drive-note-${disc.id}">${this.getDiscDriveNote(disc)}</div>
                <input
                    type="range"
                    min="-300"
                    max="300"
                    step="1"
                    value="${disc.targetRpm}"
                    data-disc-rpm="${disc.id}"
                >
            </div>
        `).join('');
    }

    syncDiscRpmControls() {
        if (!this.rpmContainer) return;

        const sliderIds = new Set(
            Array.from(this.rpmContainer.querySelectorAll('[data-disc-rpm]')).map(element => Number(element.dataset.discRpm))
        );
        const discs = this.getRpmControlledDiscs();
        const systemIds = new Set(discs.map(disc => disc.id));
        const needsRerender = sliderIds.size !== systemIds.size || [...systemIds].some(id => !sliderIds.has(id));

        if (needsRerender) {
            this.renderDiscRpmControls();
        }

        for (const disc of discs) {
            const slider = this.rpmContainer.querySelector(`[data-disc-rpm="${disc.id}"]`);
            const label = document.getElementById(`disc-rpm-value-${disc.id}`);
            const note = document.getElementById(`disc-drive-note-${disc.id}`);
            if (!slider || !label || !note) continue;

            const desiredValue = String(Math.round(disc.targetRpm));
            if (document.activeElement !== slider && slider.value !== desiredValue) {
                slider.value = desiredValue;
            }
            label.textContent = `${disc.targetRpm.toFixed(0)} rpm`;
            note.textContent = this.getDiscDriveNote(disc);
        }
    }

    onDiscRpmInput(event) {
        const slider = event.target.closest('[data-disc-rpm]');
        if (!slider) return;

        const discId = Number(slider.dataset.discRpm);
        const disc = this.app.system.getDisc(discId);
        if (!disc) return;

        const rpm = parseFloat(slider.value);
        disc.setRpm(rpm);
        if (!this.app.isPlaying) {
            disc.restRpm = rpm;
            disc.rampStartRpm = rpm;
            disc.rpm = rpm;
        }
        const label = document.getElementById(`disc-rpm-value-${disc.id}`);
        if (label) {
            label.textContent = `${rpm.toFixed(0)} rpm`;
        }
    }

    syncSidebar() {
        this.syncPlaybackButtons();
        this.syncDiscRpmControls();
        this.syncVisibilityButton();
    }

    getDiscDriveNote(disc) {
        if (disc.isHardDriven()) {
            return 'Hard drive: exact rest RPM';
        }
        if (disc.isFreewheel()) {
            return 'Freewheel: geometry-led angle';
        }
        return `Torque-limited: hybrid RPM modulation (${disc.torque.toFixed(0)}%)`;
    }

    getRpmControlledDiscs() {
        return this.app.system.discs;
    }

    getDiscLabel(disc) {
        return disc.isScreen() ? 'Screen' : 'Disc';
    }
}
