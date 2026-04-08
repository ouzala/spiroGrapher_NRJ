/**
 * KinematicSolver: warm-started Gauss-Newton least-squares solver
 */
class KinematicSolver {
    constructor(system) {
        this.system = system;
        this.maxIterations = 30;
        this.convergenceTolerance = 1e-3;
        this.jacobianEpsilon = 1e-4;
        this.damping = 1e-3;
        this.maxAngleStep = 0.35;
        this.lastSolvedAngles = new Map();
    }

    solve() {
        if (typeof mlMatrix === 'undefined') {
            return { success: false, error: 'ml-matrix is not loaded', stickAngles: [] };
        }

        const validation = this.system.validate();
        if (!validation.valid) {
            return { success: false, error: validation.message, stickAngles: [] };
        }

        const driveAnalysis = this.system.analyzeDiscDrives();

        const analysis = this.system.analyzeConstraints();
        if (!analysis.sufficient) {
            return {
                success: false,
                error: analysis.message,
                stickAngles: [],
                warnings: driveAnalysis.warnings
            };
        }

        const variables = this.getVariableSticks();
        if (variables.length === 0) {
            return { success: false, error: 'System needs at least 1 stick before playback.', stickAngles: [] };
        }

        let angles = this.initializeStickAngles(variables);
        let currentNorm = Infinity;

        for (let iter = 0; iter < this.maxIterations; iter++) {
            this.updateStickPositions(angles, variables);
            const residuals = this.computeResiduals();
            currentNorm = this.computeResidualNorm(residuals);

            if (currentNorm < this.convergenceTolerance) {
                this.commitSolvedAngles(variables, angles);
                this.updatePencilPositions();
                return {
                    success: true,
                    error: '',
                    stickAngles: angles,
                    warnings: driveAnalysis.warnings
                };
            }

            const jacobian = this.computeJacobian(angles, variables, residuals);
            const delta = this.solveLeastSquares(jacobian, residuals);
            if (!delta) {
                this.restoreCommittedAngles(variables);
                return {
                    success: false,
                    error: 'Singular Jacobian',
                    stickAngles: angles,
                    warnings: driveAnalysis.warnings
                };
            }

            const nextAngles = this.applyStep(angles, delta);
            const accepted = this.tryBacktrackingStep(angles, nextAngles, variables, currentNorm);

            if (!accepted) {
                this.restoreCommittedAngles(variables);
                return {
                    success: false,
                    error: 'Failed to decrease residual',
                    stickAngles: angles,
                    warnings: driveAnalysis.warnings
                };
            }

            angles = accepted.angles;
            currentNorm = accepted.norm;
        }

        this.updateStickPositions(angles, variables);
        this.commitSolvedAngles(variables, angles);
        return {
            success: currentNorm < this.convergenceTolerance,
            error: 'Failed to converge',
            stickAngles: angles,
            warnings: driveAnalysis.warnings
        };
    }

    getVariableSticks() {
        const sticks = [];
        for (const chain of this.system.stickChains) {
            for (const stick of chain.sticks) {
                sticks.push(stick);
            }
        }
        return sticks;
    }

    initializeStickAngles(variables) {
        return variables.map(stick => {
            if (this.lastSolvedAngles.has(stick.id)) {
                return this.lastSolvedAngles.get(stick.id);
            }
            return stick.angle || 0;
        });
    }

    updateStickPositions(stickAngles, variables = this.getVariableSticks()) {
        let stickIndex = 0;

        for (const chain of this.system.stickChains) {
            const startPos = this.getAttachmentPosition(chain.startAttachment);
            let currentX = startPos.x;
            let currentY = startPos.y;

            for (let i = 0; i < chain.sticks.length; i++) {
                const stick = chain.sticks[i];
                const angle = stickAngles[stickIndex];
                stick.setPosition(currentX, currentY, angle);
                currentX = stick.endX;
                currentY = stick.endY;
                stickIndex++;
            }
        }

        return variables;
    }

    computeResiduals() {
        const residuals = [];

        for (const chain of this.system.stickChains) {
            if (!this.hasHardEndConstraint(chain)) continue;

            const lastStick = chain.sticks[chain.sticks.length - 1];
            const endPos = this.getAttachmentPosition(chain.endAttachment);
            residuals.push(endPos.x - lastStick.endX, endPos.y - lastStick.endY);
        }

        for (const anchor of this.system.anchors) {
            const primaryPos = this.getAnchorPrimaryPosition(anchor);
            const targetPos = this.getAttachmentPosition(anchor.targetAttachment);
            residuals.push(targetPos.x - primaryPos.x, targetPos.y - primaryPos.y);
        }

        return residuals;
    }

    computeJacobian(stickAngles, variables, residuals0) {
        const { Matrix } = mlMatrix;
        const rowCount = residuals0.length;
        const columnCount = stickAngles.length;
        const jacobian = Matrix.zeros(rowCount, columnCount);

        for (let col = 0; col < columnCount; col++) {
            const original = stickAngles[col];
            stickAngles[col] = original + this.jacobianEpsilon;
            this.updateStickPositions(stickAngles, variables);
            const residuals1 = this.computeResiduals();

            for (let row = 0; row < rowCount; row++) {
                jacobian.set(row, col, (residuals1[row] - residuals0[row]) / this.jacobianEpsilon);
            }

            stickAngles[col] = original;
        }

        this.updateStickPositions(stickAngles, variables);
        return jacobian;
    }

    solveLeastSquares(jacobian, residuals) {
        const { Matrix, QrDecomposition, solve } = mlMatrix;
        const rowCount = jacobian.rows;
        const columnCount = jacobian.columns;
        if (rowCount === 0 || columnCount === 0) {
            return new Array(columnCount).fill(0);
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
            // Fall back to SVD-based solve below.
        }

        try {
            return solve(augmented, augmentedRhs, true).to1DArray();
        } catch (error) {
            return null;
        }
    }

    applyStep(angles, delta) {
        return angles.map((angle, index) => angle + MathUtils.clamp(delta[index], -this.maxAngleStep, this.maxAngleStep));
    }

    tryBacktrackingStep(currentAngles, proposedAngles, variables, currentNorm) {
        const scales = [1, 0.5, 0.25, 0.1];

        for (const scale of scales) {
            const trialAngles = currentAngles.map((angle, index) => {
                const delta = proposedAngles[index] - currentAngles[index];
                return angle + delta * scale;
            });
            this.updateStickPositions(trialAngles, variables);
            const trialResiduals = this.computeResiduals();
            const trialNorm = this.computeResidualNorm(trialResiduals);

            if (trialNorm < currentNorm) {
                return { angles: trialAngles, norm: trialNorm };
            }
        }

        this.updateStickPositions(currentAngles, variables);
        return null;
    }

    computeResidualNorm(residuals) {
        return Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0));
    }

    commitSolvedAngles(variables, angles) {
        this.updateStickPositions(angles, variables);
        for (let i = 0; i < variables.length; i++) {
            const angle = MathUtils.normalizeAngle(angles[i]);
            variables[i].angle = angle;
            this.lastSolvedAngles.set(variables[i].id, angle);
            angles[i] = angle;
        }
    }

    restoreCommittedAngles(variables) {
        const restoredAngles = variables.map(stick => {
            if (this.lastSolvedAngles.has(stick.id)) {
                return this.lastSolvedAngles.get(stick.id);
            }
            return stick.angle || 0;
        });
        this.updateStickPositions(restoredAngles, variables);
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
            if (stick) {
                return stick.getPointAtDistance(attachment.distance);
            }
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
        if (!stick) return { x: 0, y: 0 };
        return stick.getPointAtDistance(anchor.primaryAttachment.distance);
    }

    hasHardEndConstraint(chain) {
        return this.system.isHardEndAttachment(chain?.endAttachment);
    }

    updatePencilPositions() {
        for (const pencil of this.system.pencils) {
            const chain = this.system.getStickChain(pencil.stickChainId);
            if (!chain) continue;
            const stick = chain.getStick(pencil.stickIndex);
            if (!stick) continue;

            const clamped = MathUtils.clamp(pencil.positionOnStick, 0, stick.length);
            pencil.positionOnStick = clamped;
            const pos = stick.getPointAtDistance(clamped);
            pencil.x = pos.x;
            pencil.y = pos.y;
        }
    }
}
