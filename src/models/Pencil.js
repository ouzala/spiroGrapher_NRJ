/**
 * Pencil: A tracing element attached to a stick
 */
class Pencil {
    constructor(id, stickChainId, stickIndex, positionOnStick, color, persistenceDuration) {
        this.id = id;                        // unique identifier
        this.stickChainId = stickChainId;    // which chain this pencil is on
        this.stickIndex = stickIndex;        // which stick in the chain (0-indexed)
        this.positionOnStick = positionOnStick;  // distance from stick start (mm)
        this.color = color;                  // hex color string (#RRGGBB)
        this.persistenceDuration = persistenceDuration;  // how long traces persist (seconds)
        this.radius = AppConfig.SYSTEM_DEFAULTS.PENCIL_DEF_RADIUS;          // Pencil Symbol Radius
        this.trace_width = AppConfig.SYSTEM_DEFAULTS.TRACE_DEF_WIDTH;     // Pencil Symbol Radius
        
        this.x = 0;                          // current x position
        this.y = 0;                          // current y position
        this.traces = [];                    // deque of {x, y, timestamp, color}
    }

    /**
     * Update pencil position
     * @param {number} x - new x position
     * @param {number} y - new y position
     * @param {number} currentTime - current simulation time (seconds)
     */
    updatePosition(x, y, currentTime, traceData = null) {
        this.x = x;
        this.y = y;

        const trace = {
            x,
            y,
            timestamp: currentTime,
            color: this.color
        };

        if (traceData && Number.isFinite(traceData.screenId)) {
            trace.screenId = traceData.screenId;
            trace.localX = traceData.localX;
            trace.localY = traceData.localY;
        }

        this.traces.push(trace);
    }

    /**
     * Cleanup old traces
     * @param {number} currentTime - current simulation time (seconds)
     */
    cleanupTraces(currentTime) {
        // Remove traces older than persistence duration
        while (this.traces.length > 0) {
            const age = currentTime - this.traces[0].timestamp;
            if (age > this.persistenceDuration) {
                this.traces.shift();
            } else {
                break;
            }
        }
    }

    /**
     * Get trace alpha value based on age
     * @param {number} traceAge - age of trace (seconds)
     * @returns {number} alpha in [0, 1]
     */
    getTraceAlpha(traceAge) {
        if (this.persistenceDuration === 0) return 0;
        // Fade linearly from 1 to 0 over persistence duration
        return Math.max(0, 1 - (traceAge / this.persistenceDuration));
    }

    /**
     * Clear all traces
     */
    clearTraces() {
        this.traces = [];
    }

    clone() {
        const pencil = new Pencil(
            this.id,
            this.stickChainId,
            this.stickIndex,
            this.positionOnStick,
            this.color,
            this.persistenceDuration
        );
        pencil.x = this.x;
        pencil.y = this.y;
        pencil.traces = this.traces.map(trace => ({ ...trace }));
        return pencil;
    }
}
