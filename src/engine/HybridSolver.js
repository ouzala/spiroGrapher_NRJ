/**
 * HybridSolver: dynamic XPBD-style graph solver for compliant stick networks.
 *
 * Key behaviors:
 * - per-segment axial rigidity is interpreted as EA, not a raw spring constant
 * - attachments that land inside a stick are split into virtual nodes/subsegments
 * - compliant length constraints carry persistent lambdas to expose tension history
 * - adjacent segments receive second-neighbor bending constraints to spread curvature
 */
class HybridSolver {
    constructor(system) {
        this.system = system;
        this.maxIterations = AppConfig.HYBRID_SOLVER.MAX_ITERATIONS;
        this.segmentDensity = AppConfig.HYBRID_SOLVER.SEGMENT_DENSITY;
        this.globalDamping = AppConfig.HYBRID_SOLVER.GLOBAL_DAMPING;
        this.bendingStiffness = AppConfig.HYBRID_SOLVER.BENDING_STIFFNESS;
        this.bendingDamping = AppConfig.HYBRID_SOLVER.BENDING_DAMPING;
        this.complianceScale = AppConfig.HYBRID_SOLVER.XPBD_COMPLIANCE_SCALE;
        this.substeps = AppConfig.HYBRID_SOLVER.SUBSTEPS;
        this.softDriveStiffness = AppConfig.HYBRID_SOLVER.SOFT_DRIVE_STIFFNESS;
        this.driveAngularDamping = AppConfig.HYBRID_SOLVER.DRIVE_ANGULAR_DAMPING;
        this.softAttachmentCompliance = AppConfig.HYBRID_SOLVER.SOFT_ATTACHMENT_COMPLIANCE;

        this.lastSolvedNodePositions = new Map();
        this.lastSolvedDiscAngles = new Map();
        this.dynamicNodeState = new Map();
        this.dynamicDiscState = new Map();
        this.constraintLambdaState = new Map();
        this.bendingRestState = new Map();
    }

    solve(options = {}) {
        const validation = this.system.validate();
        if (!validation.valid) {
            return { success: false, error: validation.message, warnings: [] };
        }

        const topology = this.buildTopology();
        if (topology.nodes.length === 0 && topology.renderedSticks.length === 0) {
            return { success: false, error: 'System needs at least 1 stick before playback.', warnings: [] };
        }

        const hasDynamicStep = Number.isFinite(options.dtMs) && options.dtMs !== 0;
        const dtMs = hasDynamicStep ? options.dtMs : 0;
        const stepSeconds = hasDynamicStep ? Math.max(Math.abs(dtMs) / 1000, 1 / 120) : 0;
        const substeps = hasDynamicStep ? Math.max(1, this.substeps) : 1;
        const subDt = hasDynamicStep ? (stepSeconds / substeps) : (1 / 120);

        this.syncDynamicState(topology);

        for (let substep = 0; substep < substeps; substep++) {
            if (hasDynamicStep) {
                this.advanceSoftDiscs(topology, subDt);
                this.integrateNodes(topology, subDt);
            } else {
                this.refreshFixedNodes(topology);
            }
            this.projectConstraints(topology, subDt);
            if (hasDynamicStep) {
                this.updateVelocities(topology, subDt);
            }
        }

        this.applySolvedState(topology);
        this.commitSolvedState(topology);

        const metrics = this.computeMetrics(topology);
        return {
            success: true,
            error: '',
            residualNorm: metrics.constraintNorm,
            energy: metrics.energy,
            iterationCount: this.maxIterations * substeps,
            warnings: this.system.analyzeDiscDrives().warnings,
            topologySummary: {
                nodeCount: topology.nodes.length,
                variableNodeCount: topology.nodes.filter(node => node.invMass > 0).length,
                segmentCount: topology.segments.length,
                softDiscCount: topology.softDiscs.length
            }
        };
    }

    buildTopology() {
        const topology = {
            nodes: [],
            nodeMap: new Map(),
            segments: [],
            renderedSticks: [],
            hardPositionConstraints: [],
            softPositionConstraints: [],
            nodeCoincidenceConstraints: [],
            bendingConstraints: [],
            straightnessConstraints: [],
            softDiscs: [],
            hostAttachmentNodes: new Map()
        };

        const splitMap = this.collectStickSplitFractions();

        for (const chain of this.system.stickChains) {
            if (chain.sticks.length === 0) continue;

            const originalNodes = [];
            for (let nodeIndex = 0; nodeIndex <= chain.sticks.length; nodeIndex++) {
                const key = this.getNodeKey(chain.id, nodeIndex);
                const fallback = this.getCurrentNodePosition(chain.id, nodeIndex)
                    || this.getFallbackNodePosition(chain.id, nodeIndex);
                const attachment = nodeIndex === 0 ? chain.startAttachment : null;
                const node = this.getOrCreateNode(topology, key, fallback, {
                    fixedAttachment: this.isKinematicAttachment(attachment) ? attachment : null
                });
                originalNodes.push(node);
            }

            for (let stickIndex = 0; stickIndex < chain.sticks.length; stickIndex++) {
                const stick = chain.sticks[stickIndex];
                const startNode = originalNodes[stickIndex];
                const endNode = originalNodes[stickIndex + 1];
                const splitFractions = (splitMap.get(stick.id) || []).slice().sort((a, b) => a - b);
                const nodeFractions = [0, ...splitFractions, 1];
                const nodeRefs = [startNode];

                for (let i = 0; i < splitFractions.length; i++) {
                    const fraction = splitFractions[i];
                    const splitPos = {
                        x: MathUtils.lerp(stick.startX, stick.endX, fraction),
                        y: MathUtils.lerp(stick.startY, stick.endY, fraction)
                    };
                    const splitNode = this.getOrCreateNode(
                        topology,
                        `stick:${stick.id}:split:${fraction.toFixed(6)}`,
                        splitPos
                    );
                    topology.hostAttachmentNodes.set(this.getHostAttachmentKey(stick.id, fraction), splitNode);
                    nodeRefs.push(splitNode);
                }

                nodeRefs.push(endNode);
                for (let i = 0; i < nodeRefs.length - 1; i++) {
                    const fraction0 = nodeFractions[i];
                    const fraction1 = nodeFractions[i + 1];
                    const segmentRestLength = Math.max(stick.restLength * (fraction1 - fraction0), 1e-6);
                    const segment = {
                        key: `segment:${stick.id}:${i}`,
                        originalStick: stick,
                        startNode: nodeRefs[i],
                        endNode: nodeRefs[i + 1],
                        restLength: segmentRestLength,
                        axialRigidity: this.getEffectiveStickAxialRigidity(stick),
                        lambdaKey: `length:${stick.id}:${i}`
                    };
                    topology.segments.push(segment);
                }

                topology.renderedSticks.push({
                    stick,
                    startNode,
                    endNode,
                    segments: topology.segments.filter(segment => segment.originalStick.id === stick.id)
                });

                for (let i = 0; i < nodeRefs.length - 2; i++) {
                    const straightKey = `straight:stick:${stick.id}:${i}`;
                    topology.straightnessConstraints.push(this.createBendingConstraint(
                        straightKey,
                        nodeRefs[i],
                        nodeRefs[i + 1],
                        nodeRefs[i + 2]
                    ));
                }
            }

            for (let nodeIndex = 1; nodeIndex < originalNodes.length - 1; nodeIndex++) {
                topology.bendingConstraints.push(this.createBendingConstraint(
                    `bend:chain:${chain.id}:${nodeIndex}`,
                    originalNodes[nodeIndex - 1],
                    originalNodes[nodeIndex],
                    originalNodes[nodeIndex + 1]
                ));
            }

            if (chain.startAttachment) {
                const startNode = originalNodes[0];
                if (this.isKinematicAttachment(chain.startAttachment)) {
                    topology.hardPositionConstraints.push({
                        key: `start:${chain.id}`,
                        node: startNode,
                        attachment: chain.startAttachment
                    });
                } else {
                    topology.softPositionConstraints.push({
                        key: `start:${chain.id}`,
                        node: startNode,
                        attachment: chain.startAttachment,
                        compliance: this.getSoftAttachmentCompliance(chain.startAttachment)
                    });
                }
            }

            if (chain.endAttachment && this.system.getAttachmentType(chain.endAttachment) !== 'openEnd') {
                const endNode = originalNodes[originalNodes.length - 1];
                this.pushAttachmentConstraint(topology, `end:${chain.id}`, endNode, chain.endAttachment, 0);
            }
        }

        for (const anchor of this.system.anchors) {
            const primaryNode = this.resolveAttachmentNode(topology, anchor.primaryAttachment);
            if (!primaryNode) continue;
            this.pushAttachmentConstraint(topology, `anchor:${anchor.id}`, primaryNode, anchor.targetAttachment, 0);
        }

        for (const slider of this.system.sliders) {
            const sliderNode = this.resolveSliderNode(topology, slider);
            if (!sliderNode) continue;
            topology.hardPositionConstraints.push({
                key: `slider:${slider.id}`,
                node: sliderNode,
                attachment: slider.targetAttachment
                    ? slider.targetAttachment
                    : { type: 'fixedPoint', x: slider.x, y: slider.y }
            });
        }

        for (const disc of this.system.getRotatingBodies()) {
            if (!disc.isHardDriven()) {
                topology.softDiscs.push(disc);
            }
        }

        this.accumulateNodeMasses(topology);
        return topology;
    }

    collectStickSplitFractions() {
        const splitMap = new Map();
        const register = attachment => {
            if (!attachment) return;
            if (this.system.getAttachmentType(attachment) !== 'anchor') return;
            const stick = this.system.getStickById(attachment.id);
            if (!stick || !Number.isFinite(stick.restLength) || stick.restLength <= 1e-6) return;
            const fraction = MathUtils.clamp((attachment.distance || 0) / stick.restLength, 0, 1);
            if (fraction <= 1e-6 || fraction >= 1 - 1e-6) return;
            if (!splitMap.has(stick.id)) {
                splitMap.set(stick.id, []);
            }
            const values = splitMap.get(stick.id);
            if (!values.some(value => Math.abs(value - fraction) < 1e-6)) {
                values.push(fraction);
            }
        };

        for (const chain of this.system.stickChains) {
            register(chain.endAttachment);
        }
        for (const anchor of this.system.anchors) {
            register(anchor.primaryAttachment);
            register(anchor.targetAttachment);
        }

        for (const slider of this.system.sliders) {
            const stick = this.system.getStickById(slider.stickId);
            if (!stick || !Number.isFinite(stick.restLength) || stick.restLength <= 1e-6) continue;
            const fraction = MathUtils.clamp((slider.distance || 0) / stick.restLength, 0, 1);
            if (fraction <= 1e-6 || fraction >= 1 - 1e-6) continue;
            if (!splitMap.has(stick.id)) {
                splitMap.set(stick.id, []);
            }
            const values = splitMap.get(stick.id);
            if (!values.some(value => Math.abs(value - fraction) < 1e-6)) {
                values.push(fraction);
            }
        }

        return splitMap;
    }

    getOrCreateNode(topology, key, fallback, options = {}) {
        if (topology.nodeMap.has(key)) {
            const existing = topology.nodeMap.get(key);
            if (options.fixedAttachment) {
                existing.fixedAttachment = options.fixedAttachment;
            }
            return existing;
        }

        const stored = this.dynamicNodeState.get(key) || this.lastSolvedNodePositions.get(key);
        const position = stored || fallback || { x: 0, y: 0 };
        const node = {
            key,
            x: position.x,
            y: position.y,
            prevX: position.x,
            prevY: position.y,
            vx: stored?.vx || 0,
            vy: stored?.vy || 0,
            invMass: 0,
            mass: 0,
            fixedAttachment: options.fixedAttachment || null
        };

        topology.nodeMap.set(key, node);
        topology.nodes.push(node);
        return node;
    }

    createBendingConstraint(key, nodeA, nodeMid, nodeB) {
        const restDistance = this.getStoredBendingRestDistance(key, nodeA, nodeB);
        return {
            key,
            nodeA,
            nodeMid,
            nodeB,
            restDistance
        };
    }

    getStoredBendingRestDistance(key, nodeA, nodeB) {
        if (this.bendingRestState.has(key)) {
            return this.bendingRestState.get(key);
        }
        const distance = Math.max(MathUtils.distance(nodeA.x, nodeA.y, nodeB.x, nodeB.y), 1e-6);
        this.bendingRestState.set(key, distance);
        return distance;
    }

    accumulateNodeMasses(topology) {
        for (const segment of topology.segments) {
            const segmentMass = this.segmentDensity * segment.restLength;
            segment.startNode.mass += 0.5 * segmentMass;
            segment.endNode.mass += 0.5 * segmentMass;
        }

        for (const node of topology.nodes) {
            if (node.fixedAttachment) {
                node.mass = Infinity;
                node.invMass = 0;
                continue;
            }
            const mass = Math.max(node.mass, 1e-6);
            node.mass = mass;
            node.invMass = 1 / mass;
        }
    }

    syncDynamicState(topology) {
        for (const node of topology.nodes) {
            const stored = this.dynamicNodeState.get(node.key);
            if (!stored) continue;
            node.x = stored.x;
            node.y = stored.y;
            node.prevX = stored.x;
            node.prevY = stored.y;
            node.vx = stored.vx;
            node.vy = stored.vy;
        }

        for (const disc of topology.softDiscs) {
            const stored = this.dynamicDiscState.get(disc.id);
            if (stored) {
                disc.angle = stored.angle;
                disc.angularVelocity = stored.angularVelocity;
            } else {
                disc.angularVelocity = Number.isFinite(disc.angularVelocity) ? disc.angularVelocity : 0;
            }
        }
    }

    advanceSoftDiscs(topology, dt) {
        for (const disc of topology.softDiscs) {
            const torqueRatio = disc.getTorqueRatio();
            const angleError = MathUtils.normalizeAngle(disc.driveTargetAngle - disc.angle);
            disc.angularVelocity += this.softDriveStiffness * torqueRatio * angleError * dt;
            disc.angularVelocity *= Math.exp(-this.driveAngularDamping * dt);
            disc.angle = MathUtils.normalizeAngle(disc.angle + disc.angularVelocity * dt);
            disc.rpm = disc.angularVelocity * 60 / (2 * Math.PI);
        }
    }

    integrateNodes(topology, dt) {
        const dampingFactor = Math.exp(-this.globalDamping * dt);
        for (const node of topology.nodes) {
            if (node.fixedAttachment) {
                const pos = this.getAttachmentPosition(node.fixedAttachment);
                node.prevX = pos.x;
                node.prevY = pos.y;
                node.x = pos.x;
                node.y = pos.y;
                node.vx = 0;
                node.vy = 0;
                continue;
            }

            node.prevX = node.x;
            node.prevY = node.y;
            node.vx *= dampingFactor;
            node.vy *= dampingFactor;
            node.x += node.vx * dt;
            node.y += node.vy * dt;
        }
    }

    refreshFixedNodes(topology) {
        for (const node of topology.nodes) {
            if (!node.fixedAttachment) continue;
            const pos = this.getAttachmentPosition(node.fixedAttachment);
            node.prevX = pos.x;
            node.prevY = pos.y;
            node.x = pos.x;
            node.y = pos.y;
            node.vx = 0;
            node.vy = 0;
        }
    }

    projectConstraints(topology, dt) {
        const dt2 = dt * dt;
        for (let iter = 0; iter < this.maxIterations; iter++) {
            for (const constraint of topology.hardPositionConstraints) {
                this.solvePointConstraint(constraint.key, constraint.node, this.getAttachmentPosition(constraint.attachment), 0, dt2);
            }

            for (const constraint of topology.softPositionConstraints) {
                this.solvePointConstraint(
                    constraint.key,
                    constraint.node,
                    this.getAttachmentPosition(constraint.attachment),
                    constraint.compliance,
                    dt2
                );
            }

            for (const constraint of topology.nodeCoincidenceConstraints) {
                if (constraint.targetNode) {
                    this.solveCoincidenceConstraint(
                        constraint.key,
                        constraint.node,
                        constraint.targetNode,
                        constraint.compliance || 0,
                        dt2
                    );
                } else {
                    this.solvePointConstraint(
                        constraint.key,
                        constraint.node,
                        this.getAttachmentPosition(constraint.attachment),
                        constraint.compliance || 0,
                        dt2
                    );
                }
            }

            for (const segment of topology.segments) {
                const compliance = this.getSegmentCompliance(segment);
                this.solveLengthConstraint(segment.lambdaKey, segment.startNode, segment.endNode, segment.restLength, compliance, dt2);
            }

            for (const bending of topology.bendingConstraints) {
                if (this.bendingStiffness <= 0) continue;
                const compliance = 1 / Math.max(this.bendingStiffness, 1e-6);
                this.solveLengthConstraint(
                    `bendLength:${bending.key}`,
                    bending.nodeA,
                    bending.nodeB,
                    bending.restDistance,
                    compliance,
                    dt2
                );
            }

            for (const straightness of topology.straightnessConstraints) {
                this.solveLengthConstraint(
                    `straightLength:${straightness.key}`,
                    straightness.nodeA,
                    straightness.nodeB,
                    straightness.restDistance,
                    0,
                    dt2
                );
            }
        }
    }

    updateVelocities(topology, dt) {
        const bendVelocityFactor = Math.exp(-this.bendingDamping * dt);
        for (const bending of topology.bendingConstraints) {
            if (this.bendingDamping <= 0) continue;
            const avgVx = (bending.nodeA.vx + bending.nodeB.vx) * 0.5;
            const avgVy = (bending.nodeA.vy + bending.nodeB.vy) * 0.5;
            bending.nodeMid.vx = MathUtils.lerp(bending.nodeMid.vx, avgVx, 1 - bendVelocityFactor);
            bending.nodeMid.vy = MathUtils.lerp(bending.nodeMid.vy, avgVy, 1 - bendVelocityFactor);
        }

        for (const node of topology.nodes) {
            if (node.fixedAttachment) {
                node.vx = 0;
                node.vy = 0;
                continue;
            }
            node.vx = (node.x - node.prevX) / dt;
            node.vy = (node.y - node.prevY) / dt;
        }
    }

    solvePointConstraint(key, node, target, compliance, dt2) {
        this.solveAxisConstraint(`${key}:x`, node, null, target.x, 'x', compliance, dt2);
        this.solveAxisConstraint(`${key}:y`, node, null, target.y, 'y', compliance, dt2);
    }

    solveCoincidenceConstraint(key, nodeA, nodeB, compliance, dt2) {
        this.solveAxisConstraint(`${key}:x`, nodeA, nodeB, null, 'x', compliance, dt2);
        this.solveAxisConstraint(`${key}:y`, nodeA, nodeB, null, 'y', compliance, dt2);
    }

    solveAxisConstraint(key, nodeA, nodeB, targetValue, axis, compliance, dt2) {
        const persistent = compliance > 0;
        const lambda = persistent ? (this.constraintLambdaState.get(key) || 0) : 0;
        const alpha = compliance <= 0 ? 0 : compliance / Math.max(dt2, 1e-9);
        const valueA = axis === 'x' ? nodeA.x : nodeA.y;
        const valueB = nodeB ? (axis === 'x' ? nodeB.x : nodeB.y) : targetValue;
        const invMassA = nodeA.invMass;
        const invMassB = nodeB ? nodeB.invMass : 0;
        const denominator = invMassA + invMassB + alpha;
        if (denominator <= 1e-9) return;

        const constraint = valueA - valueB;
        const deltaLambda = (-constraint - alpha * lambda) / denominator;
        if (axis === 'x') {
            nodeA.x += invMassA * deltaLambda;
            if (nodeB) nodeB.x -= invMassB * deltaLambda;
        } else {
            nodeA.y += invMassA * deltaLambda;
            if (nodeB) nodeB.y -= invMassB * deltaLambda;
        }
        if (persistent) {
            this.constraintLambdaState.set(key, lambda + deltaLambda);
        } else {
            this.constraintLambdaState.delete(key);
        }
    }

    solveLengthConstraint(key, nodeA, nodeB, restLength, compliance, dt2) {
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 1e-9) return;

        const invMassA = nodeA.invMass;
        const invMassB = nodeB.invMass;
        const alpha = compliance <= 0 ? 0 : compliance / Math.max(dt2, 1e-9);
        const denominator = invMassA + invMassB + alpha;
        if (denominator <= 1e-9) return;

        const persistent = compliance > 0;
        const lambda = persistent ? (this.constraintLambdaState.get(key) || 0) : 0;
        const constraint = distance - restLength;
        const deltaLambda = (-constraint - alpha * lambda) / denominator;
        const nx = dx / distance;
        const ny = dy / distance;

        nodeA.x -= invMassA * nx * deltaLambda;
        nodeA.y -= invMassA * ny * deltaLambda;
        nodeB.x += invMassB * nx * deltaLambda;
        nodeB.y += invMassB * ny * deltaLambda;
        if (persistent) {
            this.constraintLambdaState.set(key, lambda + deltaLambda);
        } else {
            this.constraintLambdaState.delete(key);
        }
    }

    getSegmentCompliance(segment) {
        if (this.isRigidStick(segment.originalStick)) {
            return 0;
        }
        const axialRigidity = Math.max(segment.axialRigidity, 1e-6);
        return this.complianceScale * (segment.restLength / axialRigidity);
    }

    applySolvedState(topology) {
        for (const rendered of topology.renderedSticks) {
            rendered.stick.setEndpoints(
                rendered.startNode.x,
                rendered.startNode.y,
                rendered.endNode.x,
                rendered.endNode.y
            );

            const totalRestLength = rendered.segments.reduce((sum, segment) => sum + segment.restLength, 0);
            const totalActualLength = rendered.segments.reduce((sum, segment) => {
                return sum + MathUtils.distance(segment.startNode.x, segment.startNode.y, segment.endNode.x, segment.endNode.y);
            }, 0);
            const avgTension = rendered.segments.reduce((sum, segment) => {
                return sum + this.getConstraintTension(segment.lambdaKey);
            }, 0) / Math.max(rendered.segments.length, 1);

            rendered.stick.actualLength = totalActualLength;
            rendered.stick.strain = totalRestLength > 1e-9 ? (totalActualLength - totalRestLength) / totalRestLength : 0;
            rendered.stick.tension = avgTension;
        }
    }

    commitSolvedState(topology) {
        for (const node of topology.nodes) {
            this.lastSolvedNodePositions.set(node.key, { x: node.x, y: node.y });
            this.dynamicNodeState.set(node.key, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
        }

        const activeNodeKeys = new Set(topology.nodes.map(node => node.key));
        for (const key of [...this.dynamicNodeState.keys()]) {
            if (!activeNodeKeys.has(key)) {
                this.dynamicNodeState.delete(key);
                this.lastSolvedNodePositions.delete(key);
            }
        }

        for (const disc of this.system.getRotatingBodies()) {
            if (!disc.isHardDriven()) {
                this.dynamicDiscState.set(disc.id, {
                    angle: disc.angle,
                    angularVelocity: disc.angularVelocity || 0
                });
            }
            this.lastSolvedDiscAngles.set(disc.id, disc.angle);
        }

        const activePersistentConstraintKeys = new Set();
        for (const segment of topology.segments) {
            if (!this.isRigidStick(segment.originalStick)) {
                activePersistentConstraintKeys.add(segment.lambdaKey);
            }
        }
        for (const key of [...this.constraintLambdaState.keys()]) {
            if (!activePersistentConstraintKeys.has(key)) {
                this.constraintLambdaState.delete(key);
            }
        }

        this.updatePencilPositions();
    }

    computeMetrics(topology) {
        let constraintSum = 0;
        let energy = 0;

        for (const segment of topology.segments) {
            const actualLength = MathUtils.distance(
                segment.startNode.x,
                segment.startNode.y,
                segment.endNode.x,
                segment.endNode.y
            );
            const stretch = actualLength - segment.restLength;
            const axialStiffness = Math.max(segment.axialRigidity / Math.max(segment.restLength, 1e-6), 1e-6);
            constraintSum += stretch * stretch;
            energy += 0.5 * axialStiffness * stretch * stretch;
        }

        return {
            constraintNorm: Math.sqrt(constraintSum),
            energy
        };
    }

    getConstraintTension(lambdaKey) {
        return this.constraintLambdaState.get(lambdaKey) || 0;
    }

    pushAttachmentConstraint(topology, key, node, attachment, compliance) {
        const targetNode = this.resolveAttachmentNode(topology, attachment);
        if (targetNode) {
            topology.nodeCoincidenceConstraints.push({ key, node, targetNode, attachment: null, compliance });
            return;
        }
        topology.nodeCoincidenceConstraints.push({ key, node, targetNode: null, attachment, compliance });
    }

    resolveAttachmentNode(topology, attachment) {
        if (!attachment) return null;
        if (this.system.getAttachmentType(attachment) !== 'anchor') return null;

        const stick = this.system.getStickById(attachment.id);
        if (!stick || !Number.isFinite(stick.restLength) || stick.restLength <= 1e-6) return null;
        const fraction = MathUtils.clamp((attachment.distance || 0) / stick.restLength, 0, 1);
        if (fraction <= 1e-6) {
            return this.findRenderedStickEndpoint(topology, stick.id, 'start');
        }
        if (fraction >= 1 - 1e-6) {
            return this.findRenderedStickEndpoint(topology, stick.id, 'end');
        }
        return topology.hostAttachmentNodes.get(this.getHostAttachmentKey(stick.id, fraction)) || null;
    }

    resolveSliderNode(topology, slider) {
        if (!slider) return null;
        const stick = this.system.getStickById(slider.stickId);
        if (!stick || !Number.isFinite(stick.restLength) || stick.restLength <= 1e-6) return null;
        const fraction = MathUtils.clamp((slider.distance || 0) / stick.restLength, 0, 1);
        if (fraction <= 1e-6) {
            return this.findRenderedStickEndpoint(topology, stick.id, 'start');
        }
        if (fraction >= 1 - 1e-6) {
            return this.findRenderedStickEndpoint(topology, stick.id, 'end');
        }
        return topology.hostAttachmentNodes.get(this.getHostAttachmentKey(stick.id, fraction)) || null;
    }

    findRenderedStickEndpoint(topology, stickId, which) {
        const rendered = topology.renderedSticks.find(entry => entry.stick.id === stickId);
        if (!rendered) return null;
        return which === 'start' ? rendered.startNode : rendered.endNode;
    }

    getHostAttachmentKey(stickId, fraction) {
        return `${stickId}:${fraction.toFixed(6)}`;
    }

    isKinematicAttachment(attachment) {
        const type = this.system.getAttachmentType(attachment);
        if (type === 'fixedPoint') return true;
        if (type !== 'disc' && type !== 'screen') return false;
        const disc = this.system.getDriveSurface(attachment);
        return Boolean(disc?.isHardDriven());
    }

    getSoftAttachmentCompliance(attachment) {
        const type = this.system.getAttachmentType(attachment);
        if (type !== 'disc' && type !== 'screen') return 0;
        const disc = this.system.getDriveSurface(attachment);
        if (!disc) return 0;
        const torqueRatio = Math.max(disc.getTorqueRatio(), 1e-3);
        return this.softAttachmentCompliance / torqueRatio;
    }

    isRigidStick(stick) {
        const stiffnessPercent = Number.isFinite(stick.stiffness) ? stick.stiffness : 0;
        return AppConfig.clampStickStiffnessPercent(stiffnessPercent) >= AppConfig.HYBRID_SOLVER.STICK_RIGID_STIFFNESS_PERCENT;
    }

    getEffectiveStickAxialRigidity(stick) {
        const stiffnessPercent = Number.isFinite(stick.stiffness) ? stick.stiffness : 0;
        return AppConfig.getEffectiveStickAxialRigidityFromPercent(stiffnessPercent, AppConfig.HYBRID_SOLVER);
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

    getAttachmentPosition(attachment) {
        if (!attachment) return { x: 0, y: 0 };

        const type = this.system.getAttachmentType(attachment);

        if (type === 'disc' || type === 'screen') {
            const disc = this.system.getDriveSurface(attachment);
            if (!disc) return { x: 0, y: 0 };
            return disc.getPointOnSurface(attachment.distance || 0, attachment.angleOffset || 0);
        }

        if (type === 'anchor') {
            const stick = this.system.getStickById(attachment.id);
            return stick ? stick.getPointAtDistance(attachment.distance || 0) : { x: 0, y: 0 };
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
