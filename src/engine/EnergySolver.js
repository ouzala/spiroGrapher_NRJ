/**
 * EnergySolver: warm-started least-squares minimizer over joint positions.
 *
 * Unknowns are the non-hard-driven node positions. Segment rest lengths and
 * stiffness values define spring residuals; anchors and finite-torque disc
 * attachments contribute positional penalty residuals.
 */
class EnergySolver {
    constructor(system) {
        this.system = system;
        this.maxIterations = AppConfig.ENERGY_SOLVER.MAX_ITERATIONS;
        this.convergenceTolerance = AppConfig.GENERAL_SIMULATION.CONVERGENCE_TOLERANCE;
        this.jacobianEpsilon = AppConfig.GENERAL_SIMULATION.JACOBIAN_EPSILON;
        this.damping = AppConfig.ENERGY_SOLVER.DAMPING;
        this.maxCoordinateStep = AppConfig.ENERGY_SOLVER.MAX_COORDINATE_STEP;
        this.anchorStiffness = AppConfig.ENERGY_SOLVER.ANCHOR_STIFFNESS;
        this.fixedPointStiffness = AppConfig.ENERGY_SOLVER.FIXED_POINT_STIFFNESS;
        this.lastSolvedNodePositions = new Map();
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
        if (topology.variableNodes.length === 0 && topology.segments.length === 0) {
            return { success: false, error: 'System needs at least 1 stick before playback.', warnings: [] };
        }

        let nodeVector = this.initializeNodeVector(topology);
        let currentNorm = Infinity;

        for (let iter = 0; iter < this.maxIterations; iter++) {
            this.applyNodeVector(topology, nodeVector);
            const residuals = this.computeResiduals(topology);
            currentNorm = this.computeResidualNorm(residuals);

            if (currentNorm < this.convergenceTolerance) {
                this.commitSolvedState(topology, nodeVector);
                return this.buildSuccessResult(topology, residuals, iter + 1);
            }

            const jacobian = this.computeJacobian(nodeVector, topology, residuals);
            const delta = this.solveLeastSquares(jacobian, residuals);
            if (!delta) {
                this.restoreCommittedState(topology);
                return this.buildFailureResult('Singular Jacobian');
            }

            const proposed = this.applyStep(nodeVector, delta);
            const accepted = this.tryBacktrackingStep(nodeVector, proposed, topology, currentNorm);
            if (!accepted) {
                this.restoreCommittedState(topology);
                return this.buildFailureResult('Failed to decrease energy');
            }

            nodeVector = accepted.vector;
            currentNorm = accepted.norm;
        }

        this.applyNodeVector(topology, nodeVector);
        this.commitSolvedState(topology, nodeVector);
        const residuals = this.computeResiduals(topology);
        return {
            success: currentNorm < this.convergenceTolerance,
            error: currentNorm < this.convergenceTolerance ? '' : 'Failed to converge',
            residualNorm: currentNorm,
            iterationCount: this.maxIterations,
            energy: this.computeEnergyFromResiduals(residuals),
            warnings: this.system.analyzeDiscDrives().warnings
        };
    }

    buildTopology() {
        const topology = {
            nodes: [],
            variableNodes: [],
            variableIndexByNodeKey: new Map(),
            chainNodes: new Map(),
            segments: [],
            softDiscAttachments: [],
            chainEndConstraints: [],
            manualAnchors: []
        };

        for (const chain of this.system.stickChains) {
            if (chain.sticks.length === 0) continue;

            const nodes = [];
            const startAttachment = chain.startAttachment;
            const startDisc = (startAttachment?.type === 'disc' || startAttachment?.type === 'screen')
                ? this.system.getDriveSurface(startAttachment)
                : null;
            const startIsHardDriven = Boolean(startDisc?.isHardDriven());

            for (let nodeIndex = 0; nodeIndex <= chain.sticks.length; nodeIndex++) {
                const key = this.getNodeKey(chain.id, nodeIndex);
                const node = {
                    key,
                    chainId: chain.id,
                    nodeIndex,
                    fixed: nodeIndex === 0 && startIsHardDriven,
                    x: 0,
                    y: 0
                };

                if (node.fixed) {
                    const fixedPos = this.getAttachmentPosition(startAttachment);
                    node.x = fixedPos.x;
                    node.y = fixedPos.y;
                }

                nodes.push(node);
                topology.nodes.push(node);

                if (!node.fixed) {
                    topology.variableIndexByNodeKey.set(key, topology.variableNodes.length);
                    topology.variableNodes.push(node);
                }
            }

            topology.chainNodes.set(chain.id, nodes);

            for (let stickIndex = 0; stickIndex < chain.sticks.length; stickIndex++) {
                topology.segments.push({
                    chainId: chain.id,
                    stickIndex,
                    stick: chain.sticks[stickIndex],
                    startNode: nodes[stickIndex],
                    endNode: nodes[stickIndex + 1]
                });
            }

            if ((startAttachment?.type === 'disc' || startAttachment?.type === 'screen') && startDisc && !startDisc.isHardDriven()) {
                topology.softDiscAttachments.push({
                    chainId: chain.id,
                    node: nodes[0],
                    attachment: startAttachment,
                    stiffness: Math.max(1e-3, startDisc.torque)
                });
            }

            const endType = this.system.getAttachmentType(chain.endAttachment);
            if (endType === 'anchor' || endType === 'fixedPoint') {
                topology.chainEndConstraints.push({
                    chain,
                    node: nodes[nodes.length - 1],
                    attachment: chain.endAttachment,
                    stiffness: endType === 'fixedPoint' ? this.fixedPointStiffness : this.anchorStiffness
                });
            }
        }

        for (const anchor of this.system.anchors) {
            topology.manualAnchors.push({
                anchor,
                stiffness: this.anchorStiffness
            });
        }

        return topology;
    }

    initializeNodeVector(topology) {
        const vector = new Array(topology.variableNodes.length * 2).fill(0);

        for (let i = 0; i < topology.variableNodes.length; i++) {
            const node = topology.variableNodes[i];
            const stored = this.lastSolvedNodePositions.get(node.key);
            const current = this.getCurrentNodePosition(node.chainId, node.nodeIndex);
            const fallback = stored || current || this.getFallbackNodePosition(node.chainId, node.nodeIndex);
            vector[2 * i] = fallback.x;
            vector[2 * i + 1] = fallback.y;
        }

        return vector;
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
        const angle = stick?.angle || 0;
        const length = stick?.actualLength || stick?.restLength || 0;
        return {
            x: previous.x + length * Math.cos(angle),
            y: previous.y + length * Math.sin(angle)
        };
    }

    applyNodeVector(topology, vector) {
        for (let i = 0; i < topology.variableNodes.length; i++) {
            const node = topology.variableNodes[i];
            node.x = vector[2 * i];
            node.y = vector[2 * i + 1];
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

    getEffectiveStickAxialRigidity(stick) {
        const stiffnessPercent = Number.isFinite(stick.stiffness) ? stick.stiffness : 0;
        return AppConfig.getEffectiveStickAxialRigidityFromPercent(stiffnessPercent, AppConfig.ENERGY_SOLVER);
    }

    computeResiduals(topology) {
        const residuals = [];

        for (const segment of topology.segments) {
            const dx = segment.endNode.x - segment.startNode.x;
            const dy = segment.endNode.y - segment.startNode.y;
            const distance = Math.hypot(dx, dy);
            const effectiveRigidity = this.getEffectiveStickAxialRigidity(segment.stick);
            const axialStiffness = effectiveRigidity / Math.max(segment.stick.restLength, 1e-6);
            const weight = Math.sqrt(axialStiffness);
            residuals.push(weight * (distance - segment.stick.restLength));
        }

        for (const attachment of topology.softDiscAttachments) {
            const target = this.getAttachmentPosition(attachment.attachment);
            const weight = Math.sqrt(attachment.stiffness);
            residuals.push(
                weight * (attachment.node.x - target.x),
                weight * (attachment.node.y - target.y)
            );
        }

        for (const constraint of topology.chainEndConstraints) {
            const target = this.getAttachmentPosition(constraint.attachment);
            const weight = Math.sqrt(constraint.stiffness);
            residuals.push(
                weight * (constraint.node.x - target.x),
                weight * (constraint.node.y - target.y)
            );
        }

        for (const entry of topology.manualAnchors) {
            const primaryPos = this.getAnchorPrimaryPosition(entry.anchor);
            const targetPos = this.getAttachmentPosition(entry.anchor.targetAttachment);
            const weight = Math.sqrt(entry.stiffness);
            residuals.push(
                weight * (primaryPos.x - targetPos.x),
                weight * (primaryPos.y - targetPos.y)
            );
        }

        return residuals;
    }

    computeJacobian(vector, topology, residuals0) {
        const { Matrix } = mlMatrix;
        const rowCount = residuals0.length;
        const columnCount = vector.length;
        const jacobian = Matrix.zeros(rowCount, columnCount);

        for (let col = 0; col < columnCount; col++) {
            const original = vector[col];
            vector[col] = original + this.jacobianEpsilon;
            this.applyNodeVector(topology, vector);
            const residuals1 = this.computeResiduals(topology);

            for (let row = 0; row < rowCount; row++) {
                jacobian.set(row, col, (residuals1[row] - residuals0[row]) / this.jacobianEpsilon);
            }

            vector[col] = original;
        }

        this.applyNodeVector(topology, vector);
        return jacobian;
    }

    solveLeastSquares(jacobian, residuals) {
        const { Matrix, QrDecomposition, solve } = mlMatrix;
        const rowCount = jacobian.rows;
        const columnCount = jacobian.columns;
        if (columnCount === 0) {
            return [];
        }

        const rhs = Matrix.columnVector(residuals.map(value => -value));
        const lambda = Math.sqrt(this.damping);
        const augmented = Matrix.zeros(rowCount + columnCount, columnCount);
        augmented.setSubMatrix(jacobian, 0, 0);
        for (let i = 0; i < columnCount; i++) {
            augmented.set(rowCount + i, i, lambda);
        }

        const augmentedRhs = Matrix.zeros(rowCount + columnCount, 1);
        augmentedRhs.setSubMatrix(rhs, 0, 0);

        try {
            const qr = new QrDecomposition(augmented);
            if (qr.isFullRank()) {
                return qr.solve(augmentedRhs).to1DArray();
            }
        } catch (error) {
            // Fall through to SVD-based solve.
        }

        try {
            return solve(augmented, augmentedRhs, true).to1DArray();
        } catch (error) {
            return null;
        }
    }

    applyStep(vector, delta) {
        return vector.map((value, index) => {
            const step = MathUtils.clamp(delta[index], -this.maxCoordinateStep, this.maxCoordinateStep);
            return value + step;
        });
    }

    tryBacktrackingStep(currentVector, proposedVector, topology, currentNorm) {
        const scales = [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

        for (const scale of scales) {
            const trial = currentVector.map((value, index) => value + (proposedVector[index] - value) * scale);
            this.applyNodeVector(topology, trial);
            const residuals = this.computeResiduals(topology);
            const norm = this.computeResidualNorm(residuals);
            if (norm <= currentNorm + 1e-9) {
                return { vector: trial, norm };
            }
        }

        this.applyNodeVector(topology, currentVector);
        return null;
    }

    computeResidualNorm(residuals) {
        return Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0));
    }

    computeEnergyFromResiduals(residuals) {
        return 0.5 * residuals.reduce((sum, value) => sum + value * value, 0);
    }

    commitSolvedState(topology, vector) {
        this.applyNodeVector(topology, vector);
        for (const node of topology.variableNodes) {
            this.lastSolvedNodePositions.set(node.key, { x: node.x, y: node.y });
        }
        this.updatePencilPositions();
    }

    restoreCommittedState(topology) {
        const restoredVector = this.initializeNodeVector(topology);
        this.applyNodeVector(topology, restoredVector);
        this.updatePencilPositions();
    }

    buildSuccessResult(topology, residuals, iterationCount) {
        return {
            success: true,
            error: '',
            residualNorm: this.computeResidualNorm(residuals),
            iterationCount,
            energy: this.computeEnergyFromResiduals(residuals),
            warnings: this.system.analyzeDiscDrives().warnings,
            topologySummary: {
                nodeCount: topology.nodes.length,
                variableNodeCount: topology.variableNodes.length,
                segmentCount: topology.segments.length
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

    getAttachmentPosition(attachment) {
        if (!attachment) return { x: 0, y: 0 };

        const type = this.system.getAttachmentType(attachment);

        if (type === 'disc' || type === 'screen') {
            const disc = this.system.getDriveSurface(attachment);
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
