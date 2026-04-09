/**
 * HybridSolver: exact-constraint SQP solve over node positions and finite-torque disc angles.
 *
 * Exact constraints:
 * - rigid stick rest lengths
 * - stick/disc, stick/stick, and fixed-point attachments
 * - manual anchors
 *
 * Soft energy:
 * - compliant stick stretch/compression around restLength
 * - finite-torque disc preference toward its driveTargetAngle
 * - tiny freewheel continuity regularization
 */
class HybridSolver {
    constructor(system) {
        this.system = system;
        this.maxIterations = AppConfig.HYBRID_SOLVER.MAX_ITERATIONS;
        this.convergenceTolerance = AppConfig.GENERAL_SIMULATION.CONVERGENCE_TOLERANCE;
        this.jacobianEpsilon = AppConfig.GENERAL_SIMULATION.JACOBIAN_EPSILON;
        this.damping = AppConfig.HYBRID_SOLVER.DAMPING;
        this.maxCoordinateStep = AppConfig.HYBRID_SOLVER.MAX_COORDINATE_STEP;
        this.maxDiscAngleStep = AppConfig.HYBRID_SOLVER.MAX_DISC_ANGLE_STEP;
        this.meritConstraintWeight = AppConfig.HYBRID_SOLVER.MERIT_CONSTRAINT_WEIGHT;
        this.driveWeight = AppConfig.HYBRID_SOLVER.DRIVE_WEIGHT;
        this.freewheelRegularization = AppConfig.HYBRID_SOLVER.FREEWHEEL_REGULARIZATION;
        this.segmentStiffnessCutoff = AppConfig.HYBRID_SOLVER.STICK_RIGID_STIFFNESS_CUTOFF;
        this.rigidStickStiffness = AppConfig.HYBRID_SOLVER.STICK_RIGID_STIFFNESS;
        this.stickMinStiffness = AppConfig.HYBRID_SOLVER.STICK_MIN_STIFFNESS;
        this.lastSolvedNodePositions = new Map();
        this.lastSolvedDiscAngles = new Map();
    }

    solve() {
        if (typeof mlMatrix === 'undefined') {
            return { success: false, error: 'ml-matrix is not loaded', warnings: [] };
        }

        const validation = this.system.validate();
        if (!validation.valid) {
            return { success: false, error: validation.message, warnings: [] };
        }

        const topology = this.buildTopology();
        if (topology.stateLayout.length === 0 && topology.segments.length === 0) {
            return { success: false, error: 'System needs at least 1 stick before playback.', warnings: [] };
        }

        let state = this.initializeStateVector(topology);
        let lastMetrics = null;

        for (let iter = 0; iter < this.maxIterations; iter++) {
            this.applyStateVector(topology, state);
            const softResiduals = this.computeSoftResiduals(topology);
            const constraints = this.computeConstraintResiduals(topology);
            const softJacobian = this.computeJacobian(state, topology, 'soft', softResiduals);
            const constraintJacobian = this.computeJacobian(state, topology, 'constraint', constraints);
            const gradient = this.computeGradient(softJacobian, softResiduals);
            const metrics = this.computeMetrics(softResiduals, constraints, gradient);
            lastMetrics = metrics;

            if (metrics.constraintNorm < this.convergenceTolerance && metrics.gradientNorm < this.convergenceTolerance) {
                this.commitSolvedState(topology, state);
                return this.buildSuccessResult(topology, metrics, iter + 1);
            }

            const hessian = this.buildApproximateHessian(softJacobian, state.length);
            const delta = this.solveKkt(hessian, constraintJacobian, gradient, constraints);
            if (!delta) {
                this.restoreCommittedState(topology);
                return this.buildFailureResult('Singular KKT system');
            }

            const proposed = this.applyStep(state, delta, topology);
            const accepted = this.tryBacktrackingStep(state, proposed, topology, metrics.merit);
            if (!accepted) {
                this.restoreCommittedState(topology);
                return this.buildFailureResult('Failed to decrease hybrid merit');
            }

            state = accepted.state;
            lastMetrics = accepted.metrics;
        }

        this.applyStateVector(topology, state);
        this.commitSolvedState(topology, state);
        return {
            success: Boolean(lastMetrics && lastMetrics.constraintNorm < this.convergenceTolerance * 10),
            error: lastMetrics && lastMetrics.constraintNorm < this.convergenceTolerance * 10 ? '' : 'Failed to converge',
            residualNorm: lastMetrics ? lastMetrics.constraintNorm : Infinity,
            energy: lastMetrics ? lastMetrics.energy : Infinity,
            iterationCount: this.maxIterations,
            warnings: this.system.analyzeDiscDrives().warnings
        };
    }

    buildTopology() {
        const topology = {
            nodes: [],
            variableNodes: [],
            stateLayout: [],
            chainNodes: new Map(),
            segments: [],
            startConstraints: [],
            endConstraints: [],
            manualAnchors: [],
            softDiscs: [],
            rigidSegments: [],
            compliantSegments: []
        };

        for (const chain of this.system.stickChains) {
            if (chain.sticks.length === 0) continue;

            const nodes = [];
            for (let nodeIndex = 0; nodeIndex <= chain.sticks.length; nodeIndex++) {
                const attachment = nodeIndex === 0 ? chain.startAttachment : null;
                const fixed = nodeIndex === 0 && this.canFixNodeAttachment(attachment);
                const node = {
                    key: this.getNodeKey(chain.id, nodeIndex),
                    chainId: chain.id,
                    nodeIndex,
                    fixed,
                    fixedAttachment: fixed ? attachment : null,
                    x: 0,
                    y: 0
                };

                if (fixed) {
                    const fixedPos = this.getAttachmentPosition(attachment);
                    node.x = fixedPos.x;
                    node.y = fixedPos.y;
                } else {
                    topology.variableNodes.push(node);
                    topology.stateLayout.push({ type: 'nodeX', node });
                    topology.stateLayout.push({ type: 'nodeY', node });
                }

                nodes.push(node);
                topology.nodes.push(node);
            }

            topology.chainNodes.set(chain.id, nodes);

            if (chain.startAttachment && !nodes[0].fixed) {
                topology.startConstraints.push({ node: nodes[0], attachment: chain.startAttachment });
            }

            if (chain.endAttachment && this.system.getAttachmentType(chain.endAttachment) !== 'openEnd') {
                topology.endConstraints.push({ node: nodes[nodes.length - 1], attachment: chain.endAttachment });
            }

            for (let stickIndex = 0; stickIndex < chain.sticks.length; stickIndex++) {
                const segment = {
                    chainId: chain.id,
                    stickIndex,
                    stick: chain.sticks[stickIndex],
                    startNode: nodes[stickIndex],
                    endNode: nodes[stickIndex + 1]
                };
                topology.segments.push(segment);
                if (this.isRigidStick(segment.stick)) {
                    topology.rigidSegments.push(segment);
                } else {
                    topology.compliantSegments.push(segment);
                }
            }
        }

        for (const anchor of this.system.anchors) {
            topology.manualAnchors.push(anchor);
        }

        for (const disc of this.system.discs) {
            if (disc.isHardDriven()) continue;
            topology.softDiscs.push({
                disc,
                initialAngle: disc.angle,
                targetAngle: disc.driveTargetAngle
            });
            topology.stateLayout.push({ type: 'discAngle', disc });
        }

        return topology;
    }

    canFixNodeAttachment(attachment) {
        const type = this.system.getAttachmentType(attachment);
        if (type === 'fixedPoint') return true;
        if (type !== 'disc') return false;
        const disc = this.system.getDisc(attachment.id);
        return Boolean(disc?.isHardDriven());
    }

    initializeStateVector(topology) {
        const state = [];

        for (const entry of topology.stateLayout) {
            if (entry.type === 'nodeX' || entry.type === 'nodeY') {
                const node = entry.node;
                const stored = this.lastSolvedNodePositions.get(node.key);
                const current = this.getCurrentNodePosition(node.chainId, node.nodeIndex);
                const fallback = stored || current || this.getFallbackNodePosition(node.chainId, node.nodeIndex);
                state.push(entry.type === 'nodeX' ? fallback.x : fallback.y);
                continue;
            }

            if (entry.type === 'discAngle') {
                const angle = this.lastSolvedDiscAngles.has(entry.disc.id)
                    ? this.lastSolvedDiscAngles.get(entry.disc.id)
                    : entry.disc.angle;
                state.push(angle);
            }
        }

        return state;
    }

    getCurrentNodePosition(chainId, nodeIndex) {
        const chain = this.system.getStickChain(chainId);
        if (!chain || chain.sticks.length === 0) return null;

        if (nodeIndex === 0) {
            const first = chain.getStick(0);
            return first ? { x: first.startX, y: first.startY } : null;
        }

        const stick = chain.getStick(nodeIndex - 1);
        return stick ? { x: stick.endX, y: stick.endY } : null;
    }

    getFallbackNodePosition(chainId, nodeIndex) {
        const chain = this.system.getStickChain(chainId);
        if (!chain || chain.sticks.length === 0) {
            return { x: 0, y: 0 };
        }

        if (nodeIndex === 0) {
            return this.getAttachmentPosition(chain.startAttachment);
        }

        const previous = this.getFallbackNodePosition(chainId, nodeIndex - 1);
        const stick = chain.getStick(nodeIndex - 1);
        const length = stick?.actualLength || stick?.restLength || 0;
        const angle = stick?.angle || 0;
        return {
            x: previous.x + length * Math.cos(angle),
            y: previous.y + length * Math.sin(angle)
        };
    }

    applyStateVector(topology, state) {
        let index = 0;
        while (index < topology.stateLayout.length) {
            const entry = topology.stateLayout[index];
            if (entry.type === 'nodeX') {
                entry.node.x = state[index];
                index += 1;
                continue;
            }
            if (entry.type === 'nodeY') {
                entry.node.y = state[index];
                index += 1;
                continue;
            }
            if (entry.type === 'discAngle') {
                entry.disc.angle = MathUtils.normalizeAngle(state[index]);
                index += 1;
                continue;
            }
            index += 1;
        }

        for (const node of topology.nodes) {
            if (!node.fixed || !node.fixedAttachment) continue;
            const pos = this.getAttachmentPosition(node.fixedAttachment);
            node.x = pos.x;
            node.y = pos.y;
        }

        for (const segment of topology.segments) {
            segment.stick.setEndpoints(
                segment.startNode.x,
                segment.startNode.y,
                segment.endNode.x,
                segment.endNode.y
            );
        }
    }

    computeSoftResiduals(topology) {
        const residuals = [];

        for (const segment of topology.compliantSegments) {
            const dx = segment.endNode.x - segment.startNode.x;
            const dy = segment.endNode.y - segment.startNode.y;
            const distance = Math.hypot(dx, dy);
            const stiffness = this.getEffectiveStickStiffness(segment.stick);
            const weight = Math.sqrt(stiffness);
            residuals.push(weight * (distance - segment.stick.restLength));
        }

        for (const entry of topology.softDiscs) {
            const disc = entry.disc;
            if (disc.isFreewheel()) {
                const weight = Math.sqrt(this.freewheelRegularization);
                residuals.push(weight * MathUtils.normalizeAngle(disc.angle - entry.initialAngle));
                continue;
            }

            const weight = Math.sqrt(this.driveWeight * Math.max(1e-6, disc.getTorqueRatio()));
            residuals.push(weight * MathUtils.normalizeAngle(disc.angle - entry.targetAngle));
        }

        return residuals;
    }

    computeConstraintResiduals(topology) {
        const residuals = [];

        for (const constraint of topology.startConstraints) {
            const target = this.getAttachmentPosition(constraint.attachment);
            residuals.push(
                constraint.node.x - target.x,
                constraint.node.y - target.y
            );
        }

        for (const constraint of topology.endConstraints) {
            const target = this.getAttachmentPosition(constraint.attachment);
            residuals.push(
                constraint.node.x - target.x,
                constraint.node.y - target.y
            );
        }

        for (const segment of topology.rigidSegments) {
            const dx = segment.endNode.x - segment.startNode.x;
            const dy = segment.endNode.y - segment.startNode.y;
            residuals.push(dx * dx + dy * dy - segment.stick.restLength * segment.stick.restLength);
        }

        for (const anchor of topology.manualAnchors) {
            const primaryPos = this.getAnchorPrimaryPosition(anchor);
            const targetPos = this.getAttachmentPosition(anchor.targetAttachment);
            residuals.push(
                primaryPos.x - targetPos.x,
                primaryPos.y - targetPos.y
            );
        }

        return residuals;
    }

    computeJacobian(state, topology, kind, residuals0) {
        const { Matrix } = mlMatrix;
        const rowCount = residuals0.length;
        const columnCount = state.length;
        const jacobian = Matrix.zeros(rowCount, columnCount);
        if (rowCount === 0 || columnCount === 0) {
            return jacobian;
        }

        for (let col = 0; col < columnCount; col++) {
            const original = state[col];
            state[col] = original + this.jacobianEpsilon;
            this.applyStateVector(topology, state);
            const residuals1 = kind === 'soft'
                ? this.computeSoftResiduals(topology)
                : this.computeConstraintResiduals(topology);

            for (let row = 0; row < rowCount; row++) {
                jacobian.set(row, col, (residuals1[row] - residuals0[row]) / this.jacobianEpsilon);
            }

            state[col] = original;
        }

        this.applyStateVector(topology, state);
        return jacobian;
    }

    computeGradient(softJacobian, softResiduals) {
        if (softJacobian.columns === 0) return [];
        if (softJacobian.rows === 0) return new Array(softJacobian.columns).fill(0);

        const residualVector = mlMatrix.Matrix.columnVector(softResiduals);
        return softJacobian.transpose().mmul(residualVector).to1DArray();
    }

    buildApproximateHessian(softJacobian, size) {
        const { Matrix } = mlMatrix;
        const hessian = Matrix.zeros(size, size);
        if (softJacobian.rows > 0 && softJacobian.columns > 0) {
            const normal = softJacobian.transpose().mmul(softJacobian);
            hessian.setSubMatrix(normal, 0, 0);
        }
        for (let i = 0; i < size; i++) {
            hessian.set(i, i, hessian.get(i, i) + this.damping);
        }
        return hessian;
    }

    solveKkt(hessian, constraintJacobian, gradient, constraints) {
        const { Matrix, QrDecomposition, solve } = mlMatrix;
        const stateCount = hessian.rows;
        const constraintCount = constraintJacobian.rows;

        if (stateCount === 0) {
            return [];
        }

        if (constraintCount === 0) {
            const rhs = Matrix.columnVector(gradient.map(value => -value));
            try {
                const qr = new QrDecomposition(hessian);
                if (qr.isFullRank()) {
                    return qr.solve(rhs).to1DArray();
                }
            } catch (error) {
                // Fall back to SVD-based solve below.
            }

            try {
                return solve(hessian, rhs, true).to1DArray();
            } catch (error) {
                return null;
            }
        }

        const kkt = Matrix.zeros(stateCount + constraintCount, stateCount + constraintCount);
        kkt.setSubMatrix(hessian, 0, 0);
        kkt.setSubMatrix(constraintJacobian.transpose(), 0, stateCount);
        kkt.setSubMatrix(constraintJacobian, stateCount, 0);

        const rhs = Matrix.zeros(stateCount + constraintCount, 1);
        rhs.setSubMatrix(Matrix.columnVector(gradient.map(value => -value)), 0, 0);
        rhs.setSubMatrix(Matrix.columnVector(constraints.map(value => -value)), stateCount, 0);

        try {
            const qr = new QrDecomposition(kkt);
            if (qr.isFullRank()) {
                return qr.solve(rhs).to1DArray().slice(0, stateCount);
            }
        } catch (error) {
            // Fall back to SVD-based solve below.
        }

        try {
            return solve(kkt, rhs, true).to1DArray().slice(0, stateCount);
        } catch (error) {
            return null;
        }
    }

    applyStep(state, delta, topology) {
        return state.map((value, index) => {
            const entry = topology.stateLayout[index];
            const limit = entry?.type === 'discAngle' ? this.maxDiscAngleStep : this.maxCoordinateStep;
            const step = MathUtils.clamp(delta[index], -limit, limit);
            return value + step;
        });
    }

    tryBacktrackingStep(currentState, proposedState, topology, currentMerit) {
        const scales = [1, 0.5, 0.25, 0.1];

        for (const scale of scales) {
            const trial = currentState.map((value, index) => value + (proposedState[index] - value) * scale);
            this.applyStateVector(topology, trial);
            const softResiduals = this.computeSoftResiduals(topology);
            const constraints = this.computeConstraintResiduals(topology);
            const merit = this.computeMerit(softResiduals, constraints);
            if (merit < currentMerit) {
                const softJacobian = this.computeJacobian(trial, topology, 'soft', softResiduals);
                const gradient = this.computeGradient(softJacobian, softResiduals);
                return {
                    state: trial,
                    metrics: this.computeMetrics(softResiduals, constraints, gradient)
                };
            }
        }

        this.applyStateVector(topology, currentState);
        return null;
    }

    computeMetrics(softResiduals, constraints, gradient) {
        return {
            softNorm: this.computeResidualNorm(softResiduals),
            constraintNorm: this.computeResidualNorm(constraints),
            gradientNorm: this.computeResidualNorm(gradient),
            energy: this.computeEnergyFromResiduals(softResiduals),
            merit: this.computeMerit(softResiduals, constraints)
        };
    }

    computeMerit(softResiduals, constraints) {
        return this.computeEnergyFromResiduals(softResiduals)
            + this.meritConstraintWeight * constraints.reduce((sum, value) => sum + value * value, 0);
    }

    computeResidualNorm(values) {
        return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    }

    computeEnergyFromResiduals(residuals) {
        return 0.5 * residuals.reduce((sum, value) => sum + value * value, 0);
    }

    commitSolvedState(topology, state) {
        this.applyStateVector(topology, state);

        for (const node of topology.variableNodes) {
            this.lastSolvedNodePositions.set(node.key, { x: node.x, y: node.y });
        }

        for (const entry of topology.softDiscs) {
            const disc = entry.disc;
            disc.angle = MathUtils.normalizeAngle(disc.angle);
            this.lastSolvedDiscAngles.set(disc.id, disc.angle);
            if (disc.lastDriveDtMs) {
                const deltaAngle = MathUtils.normalizeAngle(disc.angle - entry.initialAngle);
                disc.rpm = deltaAngle * 60000 / (2 * Math.PI * disc.lastDriveDtMs);
            }
        }

        this.updatePencilPositions();
    }

    restoreCommittedState(topology) {
        for (const node of topology.variableNodes) {
            const stored = this.lastSolvedNodePositions.get(node.key);
            if (stored) {
                node.x = stored.x;
                node.y = stored.y;
            }
        }

        for (const entry of topology.softDiscs) {
            const storedAngle = this.lastSolvedDiscAngles.get(entry.disc.id);
            if (Number.isFinite(storedAngle)) {
                entry.disc.angle = storedAngle;
            }
        }

        const restoredState = this.initializeStateVector(topology);
        this.applyStateVector(topology, restoredState);
        this.updatePencilPositions();
    }

    buildSuccessResult(topology, metrics, iterationCount) {
        return {
            success: true,
            error: '',
            residualNorm: metrics.constraintNorm,
            energy: metrics.energy,
            iterationCount,
            warnings: this.system.analyzeDiscDrives().warnings,
            topologySummary: {
                nodeCount: topology.nodes.length,
                variableNodeCount: topology.variableNodes.length,
                segmentCount: topology.segments.length,
                softDiscCount: topology.softDiscs.length
            }
        };
    }

    buildFailureResult(error) {
        return {
            success: false,
            error,
            warnings: this.system.analyzeDiscDrives().warnings
        };
    }

    isRigidStick(stick) {
        return Number.isFinite(stick.stiffness) && stick.stiffness >= this.segmentStiffnessCutoff;
    }

    getEffectiveStickStiffness(stick) {
        const stiffness = Number.isFinite(stick.stiffness) ? stick.stiffness : 0;
        return stiffness >= this.segmentStiffnessCutoff
            ? this.rigidStickStiffness
            : Math.max(this.stickMinStiffness, stiffness);
    }

    getAttachmentPosition(attachment) {
        if (!attachment) return { x: 0, y: 0 };

        const type = this.system.getAttachmentType(attachment);

        if (type === 'disc') {
            const disc = this.system.getDisc(attachment.id);
            if (!disc) return { x: 0, y: 0 };
            return disc.getPointOnSurface(attachment.distance, attachment.angleOffset || 0);
        }

        if (type === 'anchor') {
            const stick = this.system.getStickById(attachment.id);
            return stick ? stick.getPointAtDistance(attachment.distance) : { x: 0, y: 0 };
        }

        if (type === 'fixedPoint') {
            return { x: attachment.x, y: attachment.y };
        }

        return { x: 0, y: 0 };
    }

    getAnchorPrimaryPosition(anchor) {
        if (!anchor?.primaryAttachment || anchor.primaryAttachment.type !== 'stick') {
            return { x: 0, y: 0 };
        }

        const stick = this.system.getStickById(anchor.primaryAttachment.id);
        return stick ? stick.getPointAtDistance(anchor.primaryAttachment.distance) : { x: 0, y: 0 };
    }

    getNodeKey(chainId, nodeIndex) {
        return `${chainId}:${nodeIndex}`;
    }

    updatePencilPositions() {
        for (const pencil of this.system.pencils) {
            const chain = this.system.getStickChain(pencil.stickChainId);
            if (!chain) continue;
            const stick = chain.getStick(pencil.stickIndex);
            if (!stick) continue;

            const clamped = MathUtils.clamp(pencil.positionOnStick, 0, stick.restLength);
            pencil.positionOnStick = clamped;
            const pos = stick.getPointAtDistance(clamped);
            pencil.x = pos.x;
            pencil.y = pos.y;
        }
    }
}
