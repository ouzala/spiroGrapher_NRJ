/**
 * CanvasRenderer: Renders the kinematic system to Canvas 2D
 */
class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.width = canvas.width;
        this.height = canvas.height;
        this.scale = 1;
        this.panX = this.width / 2;
        this.panY = this.height / 2;
        this.zoom = 1;

        this.colors = {
            background: '#282828',
            gridColor: '#333',
            
            discFill: '#3498db',
            discStroke: '#2980b9',
            discCenter: '#103a5c',
            
            stickStroke: '#e74c3c',
            stickWidth: 3,
            jointRadius: 4,
            jointFill: '#ff4d4f',
            
            anchorFill: '#f1c40f',
            anchorStroke: '#c89d08',
            
            pencilDefaultColor: '#6dd3c7',
            pencilRadius: 4,

            screenFill: '#080808',
            screenStroke: '#080808',
            screenCenter: '#080808',
        };
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.width = width;
        this.height = height;
        if (!Number.isFinite(this.panX) || !Number.isFinite(this.panY)) {
            this.panX = this.width / 2;
            this.panY = this.height / 2;
        }
    }

    worldToCanvas(x, y) {
        return {
            x: this.panX + x * this.scale * this.zoom,
            y: this.panY + y * this.scale * this.zoom
        };
    }

    canvasToWorld(x, y) {
        return {
            x: (x - this.panX) / (this.scale * this.zoom),
            y: (y - this.panY) / (this.scale * this.zoom)
        };
    }

    panBy(deltaX, deltaY) {
        this.panX += deltaX;
        this.panY += deltaY;
    }

    zoomAt(canvasX, canvasY, zoomFactor) {
        const nextZoom = MathUtils.clamp(this.zoom * zoomFactor, 0.2, 6);
        if (Math.abs(nextZoom - this.zoom) < 1e-6) return;

        const worldBefore = this.canvasToWorld(canvasX, canvasY);
        this.zoom = nextZoom;
        this.panX = canvasX - worldBefore.x * this.scale * this.zoom;
        this.panY = canvasY - worldBefore.y * this.scale * this.zoom;
    }

    clear() {
        this.ctx.fillStyle = this.colors.background;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.drawGrid();
    }

    drawGrid() {
        const gridSpacing = 100 * this.scale * this.zoom;
        if (gridSpacing < 20) return;

        this.ctx.strokeStyle = this.colors.gridColor;
        this.ctx.lineWidth = 0.5;

        let x = this.panX % gridSpacing;
        while (x < this.width) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
            x += gridSpacing;
        }

        let y = this.panY % gridSpacing;
        while (y < this.height) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
            y += gridSpacing;
        }
    }

    render(system, options = {}) {
        const showMechanics = options.showMechanics !== false;
        this.clear();

        for (const disc of system.getScreens()) {
            this.drawDisc(disc);
        }

        if (showMechanics) {
            for (const disc of system.getStandardDiscs()) {
                this.drawDisc(disc);
            }
        }

        for (const pencil of system.pencils) {
            this.drawTrace(pencil, system);
        }

        if (showMechanics) {
            for (const chain of system.stickChains) {
                this.drawStickChain(chain);
            }

            for (const disc of system.getStandardDiscs()) {
                this.drawDiscCenter(disc);
            }

            for (const chain of system.stickChains) {
                this.drawAttachmentMarkers(chain, system);
            }

            for (const anchor of system.anchors) {
                this.drawManualAnchor(anchor, system);
            }
        }

        for (const pencil of system.pencils) {
            this.drawPencil(pencil);
        }
    }

    drawPendingDisc(centerX, centerY, radius) {
        const canvasPos = this.worldToCanvas(centerX, centerY);
        const radiusPixels = radius * this.scale * this.zoom;

        this.ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, radiusPixels, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, radiusPixels, 0, 2 * Math.PI);
        this.ctx.stroke();

        this.drawDiscCenter({ x: centerX, y: centerY });
    }

    drawPendingStick(startX, startY, endX, endY) {
        const startPos = this.worldToCanvas(startX, startY);
        const endPos = this.worldToCanvas(endX, endY);

        this.ctx.strokeStyle = 'rgba(255, 120, 120, 0.85)';
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(startPos.x, startPos.y);
        this.ctx.lineTo(endPos.x, endPos.y);
        this.ctx.stroke();

        this.drawJoint(startX, startY);
        this.drawJoint(endX, endY);
    }

    drawDisc(disc) {
        const canvasPos = this.worldToCanvas(disc.x, disc.y);
        const radiusPixels = disc.radius * this.scale * this.zoom;
        const isScreen = disc.kind === 'screen';

        const fillStyle = isScreen
            ? this.hexToRgbA(disc.color || '#6dd3c7', disc.transparencyMode ? 0.2 : 0.45)
            : this.colors.discFill;
        const strokeStyle = isScreen
            ? (disc.color || '#6dd3c7')
            : this.colors.discStroke;    

        this.ctx.fillStyle = fillStyle;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, radiusPixels, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = strokeStyle;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, radiusPixels, 0, 2 * Math.PI);
        this.ctx.stroke();

        if (!isScreen) {
            const indicator = this.worldToCanvas(
                disc.x + disc.radius * 0.7 * Math.cos(disc.angle),
                disc.y + disc.radius * 0.7 * Math.sin(disc.angle)
            );
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(canvasPos.x, canvasPos.y);
            this.ctx.lineTo(indicator.x, indicator.y);
            this.ctx.stroke();
        } else {
            this.ctx.fillStyle = strokeStyle;
            this.ctx.font = '11px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('SCREEN', canvasPos.x, canvasPos.y);
        }
    }

    drawDiscCenter(disc) {
        const center = this.worldToCanvas(disc.x, disc.y);
        this.ctx.fillStyle = this.colors.discCenter;
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, 5, 0, 2 * Math.PI);
        this.ctx.fill();
    }

    drawStickChain(chain) {
        this.ctx.strokeStyle = this.colors.stickStroke;
        this.ctx.lineWidth = this.colors.stickWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        for (const stick of chain.sticks) {
            const startPos = this.worldToCanvas(stick.startX, stick.startY);
            const endPos = this.worldToCanvas(stick.endX, stick.endY);
            this.ctx.beginPath();
            this.ctx.moveTo(startPos.x, startPos.y);
            this.ctx.lineTo(endPos.x, endPos.y);
            this.ctx.stroke();
        }
    }

    drawJoint(x, y, options = {}) {
        const canvasPos = this.worldToCanvas(x, y);
        const radius = options.radius ?? this.colors.jointRadius;
        this.ctx.fillStyle = options.fill ?? this.colors.jointFill;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, radius, 0, 2 * Math.PI);
        this.ctx.fill();

        if (options.stroke) {
            this.ctx.strokeStyle = options.stroke;
            this.ctx.lineWidth = options.lineWidth ?? 1.5;
            this.ctx.beginPath();
            this.ctx.arc(canvasPos.x, canvasPos.y, radius, 0, 2 * Math.PI);
            this.ctx.stroke();
        }
    }

    drawAttachmentMarkers(chain, system) {
        if (chain.startAttachment) {
            const start = this.getAttachmentPosition(chain.startAttachment, system);
            if (start) this.drawJoint(start.x, start.y);
        }

        for (let i = 0; i < chain.sticks.length - 1; i++) {
            this.drawJoint(chain.sticks[i].endX, chain.sticks[i].endY);
        }

        if (chain.endAttachment) {
            const end = chain.endAttachment.type === 'openEnd'
                ? chain.sticks[chain.sticks.length - 1]?.getEndPoint()
                : this.getAttachmentPosition(chain.endAttachment, system);
            const endType = system.getAttachmentType(chain.endAttachment);
            if (end) {
                this.drawJoint(end.x, end.y, endType === 'anchor' || endType === 'fixedPoint'
                    ? {
                        fill: this.colors.anchorFill,
                        stroke: this.colors.anchorStroke,
                        radius: this.colors.jointRadius + 1
                    }
                    : {});
            }
        }
    }

    drawManualAnchor(anchor, system) {
        if (!anchor?.primaryAttachment || anchor.primaryAttachment.type !== 'stick') return;
        const stick = system.getStickById(anchor.primaryAttachment.id);
        if (!stick) return;

        const pos = stick.getPointAtDistance(anchor.primaryAttachment.distance);
        this.drawJoint(pos.x, pos.y, {
            fill: this.colors.anchorFill,
            stroke: this.colors.anchorStroke,
            radius: this.colors.jointRadius + 1
        });
    }

    getAttachmentPosition(attachment, system) {
        if (!attachment) return null;

        const type = system.getAttachmentType(attachment);

        if (type === 'disc' || type === 'screen') {
            const disc = system.getDriveSurface(attachment);
            return disc ? disc.getPointOnSurface(attachment.distance, attachment.angleOffset || 0) : null;
        }

        if (type === 'anchor') {
            const stick = system.getStickById(attachment.id);
            return stick ? stick.getPointAtDistance(attachment.distance) : null;
        }

        if (type === 'fixedPoint') {
            return { x: attachment.x, y: attachment.y };
        }

        return null;
    }

    drawPencil(pencil) {
        const canvasPos = this.worldToCanvas(pencil.x, pencil.y);
        this.ctx.fillStyle = pencil.color;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, this.colors.pencilRadius, 0, 2 * Math.PI);
        this.ctx.fill();

        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(canvasPos.x, canvasPos.y, this.colors.pencilRadius, 0, 2 * Math.PI);
        this.ctx.stroke();
    }

    drawTrace(pencil, system) {
        if (pencil.traces.length < 2) return;

        const currentTime = system.simTime || 0;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        for (let i = 0; i < pencil.traces.length - 1; i++) {
            const t1 = pencil.traces[i];
            const t2 = pencil.traces[i + 1];
            const age = currentTime - t1.timestamp;
            const alpha = pencil.getTraceAlpha(age);
            if (alpha <= 0) continue;

            const pos1World = this.getTraceWorldPosition(t1, system);
            const pos2World = this.getTraceWorldPosition(t2, system);
            if (!pos1World || !pos2World) continue;
            const pos1 = this.worldToCanvas(pos1World.x, pos1World.y);
            const pos2 = this.worldToCanvas(pos2World.x, pos2World.y);

            this.ctx.strokeStyle = this.hexToRgbA(t1.color, alpha);
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(pos1.x, pos1.y);
            this.ctx.lineTo(pos2.x, pos2.y);
            this.ctx.stroke();
        }
    }

    hexToRgbA(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    getTraceWorldPosition(trace, system) {
        if (!Number.isFinite(trace.screenId)) return null;

        const screen = system.getScreen(trace.screenId);
        if (!screen) return null;
        return screen.localToWorld({ x: trace.localX, y: trace.localY });
    
    }

    hitTest(canvasX, canvasY, system, tolerance = 15, options = {}) {
        const skipStickIds = new Set(options.skipStickIds || []);

        for (const pencil of system.pencils) {
            const pos = this.worldToCanvas(pencil.x, pencil.y);
            if (Math.hypot(canvasX - pos.x, canvasY - pos.y) <= tolerance) {
                return { type: 'pencil', id: pencil.id };
            }
        }

        for (const anchor of system.anchors) {
            if (!anchor?.primaryAttachment || anchor.primaryAttachment.type !== 'stick') continue;
            const stick = system.getStickById(anchor.primaryAttachment.id);
            if (!stick) continue;
            const point = stick.getPointAtDistance(anchor.primaryAttachment.distance);
            const pos = this.worldToCanvas(point.x, point.y);
            if (Math.hypot(canvasX - pos.x, canvasY - pos.y) <= tolerance) {
                return { type: 'anchor', id: anchor.id };
            }
        }

        for (const chain of system.stickChains) {
            for (let i = 0; i < chain.sticks.length; i++) {
                const stick = chain.sticks[i];
                if (skipStickIds.has(stick.id)) continue;

                if (i === 0) {
                    const start = this.worldToCanvas(stick.startX, stick.startY);
                    if (Math.hypot(canvasX - start.x, canvasY - start.y) <= tolerance) {
                        return { type: 'stick-start', id: stick.id, chainId: chain.id, stickIndex: i };
                    }
                }

                if (i === chain.sticks.length - 1) {
                    const end = this.worldToCanvas(stick.endX, stick.endY);
                    if (Math.hypot(canvasX - end.x, canvasY - end.y) <= tolerance) {
                        return { type: 'stick-end', id: stick.id, chainId: chain.id, stickIndex: i };
                    }
                }
            }
        }

        const stickHit = this.findStickAtCanvas(canvasX, canvasY, system, tolerance, options);
        if (stickHit) {
            return stickHit;
        }

        for (const disc of system.getRotatingBodies()) {
            const center = this.worldToCanvas(disc.x, disc.y);
            const centerDist = Math.hypot(canvasX - center.x, canvasY - center.y);
            if (centerDist <= tolerance) {
                return { type: `${disc.kind}-center`, id: disc.id };
            }

            const radiusPixels = disc.radius * this.scale * this.zoom;
            if (centerDist <= radiusPixels + tolerance) {
                return { type: disc.kind, id: disc.id };
            }
        }

        return null;
    }

    findStickAtCanvas(canvasX, canvasY, system, tolerance = 15, options = {}) {
        const skipStickIds = new Set(options.skipStickIds || []);

        for (const chain of system.stickChains) {
            for (let i = 0; i < chain.sticks.length; i++) {
                const stick = chain.sticks[i];
                if (skipStickIds.has(stick.id)) continue;

                const startPos = this.worldToCanvas(stick.startX, stick.startY);
                const endPos = this.worldToCanvas(stick.endX, stick.endY);
                const projection = this.projectPointOntoSegment(
                    canvasX,
                    canvasY,
                    startPos.x,
                    startPos.y,
                    endPos.x,
                    endPos.y
                );

                if (projection.distance <= tolerance) {
                    return {
                        type: 'stick',
                        id: stick.id,
                        chainId: chain.id,
                        stickIndex: i,
                        t: projection.t,
                        point: this.canvasToWorld(projection.x, projection.y)
                    };
                }
            }
        }

        return null;
    }

    pointToLineDistance(px, py, x1, y1, x2, y2) {
        return this.projectPointOntoSegment(px, py, x1, y1, x2, y2).distance;
    }

    projectPointOntoSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;
        const rawT = lengthSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        const t = Math.max(0, Math.min(1, rawT));
        const x = x1 + t * dx;
        const y = y1 + t * dy;

        return {
            x,
            y,
            t,
            distance: Math.hypot(px - x, py - y)
        };
    }
}
