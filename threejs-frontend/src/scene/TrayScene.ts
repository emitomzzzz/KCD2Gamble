import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

const TRAY_WIDTH = 20.6;
const TRAY_DEPTH = 15.2;
const TRAY_FELT_HEIGHT = 0.25;
const TRAY_WALL_HEIGHT = 0.55;
const TRAY_WALL_THICKNESS = 0.55;
const TRAY_FELT_CENTER_Y = 0.12;
const DIE_SIZE = 0.76;
const DIE_REST_Y = TRAY_FELT_CENTER_Y + TRAY_FELT_HEIGHT * 0.5 + DIE_SIZE * 0.5;
const ROLL_DURATION_MS = 1320;
const TAKE_DURATION_MS = 560;
const ROLL_ALIGNMENT_START_PROGRESS = 0.38;
const ROLL_FINAL_LOCK_PROGRESS = 0.88;
const ROLL_GRAVITY = 18;
const ROLL_AIR_DRAG = 0.985;
const ROLL_GROUND_DRAG = 0.84;
const ROLL_BOUNCE_RESTITUTION = 0.24;
const ROLL_TARGET_PULL_EARLY = 0.82;
const ROLL_TARGET_PULL_END_PROGRESS = 0.42;
const WALL_BOUNCE_RESTITUTION = 0.18;
const PLAY_AREA_MARGIN = DIE_SIZE * 0.82;
const REST_LAYOUT_CENTER_Z = -TRAY_DEPTH * 0.06;
const DIE_COLLISION_DISTANCE = DIE_SIZE * 1.24;
const DIE_COLLISION_HEIGHT = DIE_SIZE * 1.1;
const HOVER_LIFT = 0.06;
const SELECTED_LIFT = 0.12;
const SHADOW_Y = TRAY_FELT_CENTER_Y + TRAY_FELT_HEIGHT * 0.5 + 0.006;
const SHADOW_MIN_OPACITY = 0.08;
const SHADOW_MAX_OPACITY = 0.26;
const SHADOW_BASE_SCALE = 0.94;
const RING_PULSE_SPEED = 0.0064;
const CAMERA_FOV = 28;
const CAMERA_FORWARD_OFFSET = 0.08;
const CAMERA_FRAME_MARGIN = 0.94;
const CAMERA_MIN_DISTANCE = 12;
const CAMERA_MAX_DISTANCE = 64;

type DieFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

type DieMesh = Mesh<BoxGeometry, MeshStandardMaterial[]>;
type SelectionRingMesh = Mesh<RingGeometry, MeshBasicMaterial>;
type ContactShadowMesh = Mesh<CircleGeometry, MeshBasicMaterial>;

interface RollAnimationState {
  position: Vector3;
  velocity: Vector3;
  targetPosition: Vector3;
  bounceCount: number;
  settled: boolean;
  angularVelocity: Vector3;
  tumbleEuler: Euler;
  quaternion: Quaternion;
  spinQuaternion: Quaternion;
  targetQuaternion: Quaternion;
}

interface TakeAnimationState {
  startPosition: Vector3;
  targetPosition: Vector3;
  startRotation: Vector3;
  spinRotation: Vector3;
  startScale: number;
  targetScale: number;
  selected: boolean;
}

interface RestLayout {
  count: number;
  positions: Vector3[];
  rotations: Vector3[];
}

interface PlayBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const ZERO_VECTOR = new Vector3(0, 0, 0);

export class TrayScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly diceGroup: Group;
  private readonly raycaster: Raycaster;
  private readonly pointer: Vector2;
  private diceMeshes: DieMesh[] = [];
  private selectedIndices = new Set<number>();
  private hoveredIndex: number | null = null;
  private interactive = false;
  private dieClickHandler: ((index: number) => void) | null = null;
  private animationFrameId: number | null = null;
  private transitionQueue: Promise<void> = Promise.resolve();
  private transitionActive = false;
  private disposed = false;
  private restLayout: RestLayout | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene();
    this.scene.background = new Color('#d8d0c3');

    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    this.updateCameraFrame();

    this.diceGroup = new Group();
    this.raycaster = new Raycaster();
    this.pointer = new Vector2();

    this.createLights();
    this.createEnvironment();
    this.createTray();
    this.scene.add(this.diceGroup);
    this.setDiceValues([1, 5, 2, 6, 3, 4]);
    this.handleResize();

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    window.addEventListener('resize', this.handleResize);
  }

  start(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    const loop = (timestamp: number) => {
      this.animationFrameId = window.requestAnimationFrame(loop);
      this.updateDynamicOverlays(timestamp);
      this.renderer.render(this.scene, this.camera);
    };

    this.animationFrameId = window.requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    window.removeEventListener('resize', this.handleResize);
    this.clearDice();
    this.renderer.dispose();
  }

  setDieClickHandler(handler: ((index: number) => void) | null): void {
    this.dieClickHandler = handler;
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;

    if (!interactive && this.hoveredIndex !== null) {
      this.hoveredIndex = null;
      this.updateDieHighlights();
    }

    this.refreshCursor();
  }

  setDiceValues(values: number[]): void {
    this.rebuildDice(values);
  }

  setSelectedIndices(indices: number[]): void {
    this.selectedIndices = new Set(indices);
    this.updateDieHighlights();
  }

  playRollAnimation(finalValues: number[], startingCount = finalValues.length): Promise<void> {
    return this.enqueueTransition(async () => {
      if (finalValues.length === 0) {
        this.setDiceValues([]);
        return;
      }

      const diceCount = startingCount > 0 ? startingCount : finalValues.length;
      const rolledValues = Array.from({ length: diceCount }, (_, index) => finalValues[index] ?? 1);
      this.selectedIndices.clear();
      this.hoveredIndex = null;
      this.setInteractive(false);
      this.rebuildDice(rolledValues);

      const { positions: targetPositions, rotations: targetRotations } = this.prepareRestLayout(finalValues.length, true);
      const states = this.diceMeshes.map<RollAnimationState>((die, index) => {
        const startPosition = new Vector3(
          randomRange(-1.1, 1.1),
          randomRange(3.3, 4.3),
          randomRange(-TRAY_DEPTH * 0.48, -TRAY_DEPTH * 0.2),
        );
        const startRotation = new Euler(
          randomRange(0, Math.PI * 2),
          randomRange(0, Math.PI * 2),
          randomRange(0, Math.PI * 2),
        );
        const targetPosition = targetPositions[index] ?? new Vector3(0, DIE_REST_Y, 0);
        const targetRotation = targetRotations[index] ?? new Vector3();
        const targetQuaternion = new Quaternion().setFromEuler(
          new Euler(targetRotation.x, targetRotation.y, targetRotation.z),
        );
        const quaternion = new Quaternion().setFromEuler(startRotation);
        const velocity = new Vector3(
          (targetPosition.x - startPosition.x) * randomRange(1.75, 2.45),
          randomRange(4.1, 5.3),
          (targetPosition.z - startPosition.z) * randomRange(1.55, 2.3) + randomRange(1.6, 2.5),
        );
        const angularVelocity = new Vector3(
          randomSignedRange(10, 16),
          randomSignedRange(8, 13),
          randomSignedRange(10, 16),
        );

        die.position.copy(startPosition);
        die.quaternion.copy(quaternion);
        die.scale.setScalar(1);
        this.setDieOpacity(die, 1);

        return {
          position: startPosition.clone(),
          velocity,
          targetPosition,
          bounceCount: 0,
          settled: false,
          angularVelocity,
          tumbleEuler: new Euler(),
          quaternion,
          spinQuaternion: new Quaternion(),
          targetQuaternion,
        };
      });

      const playBounds = this.getPlayBounds();

      await this.animate(ROLL_DURATION_MS, (progress, deltaMs) => {
        const dt = Math.min(Math.max(deltaMs, 16.67), 32) / 1000;
        const alignmentWindow = MathUtils.smoothstep(progress, ROLL_ALIGNMENT_START_PROGRESS, 1);
        this.diceMeshes.forEach((die, index) => {
          const state = states[index];
          if (!state) {
            return;
          }

          if (!state.settled) {
            state.velocity.y -= ROLL_GRAVITY * dt;
            const targetPullStrength =
              progress < ROLL_TARGET_PULL_END_PROGRESS && state.bounceCount === 0
                ? ROLL_TARGET_PULL_EARLY * (1 - progress / ROLL_TARGET_PULL_END_PROGRESS)
                : 0;

            if (targetPullStrength > 0) {
              state.velocity.x += (state.targetPosition.x - state.position.x) * targetPullStrength * dt;
              state.velocity.z += (state.targetPosition.z - state.position.z) * targetPullStrength * dt;
            }

            const drag = state.position.y <= DIE_REST_Y + 0.001 ? ROLL_GROUND_DRAG : ROLL_AIR_DRAG;
            state.velocity.multiplyScalar(drag);
            state.position.addScaledVector(state.velocity, dt);

            if (state.position.x < playBounds.minX || state.position.x > playBounds.maxX) {
              state.position.x = MathUtils.clamp(state.position.x, playBounds.minX, playBounds.maxX);
              state.velocity.x *= -WALL_BOUNCE_RESTITUTION;
              state.velocity.z *= 0.92;
              state.angularVelocity.y *= 0.9;
            }

            if (state.position.z < playBounds.minZ || state.position.z > playBounds.maxZ) {
              state.position.z = MathUtils.clamp(state.position.z, playBounds.minZ, playBounds.maxZ);
              state.velocity.z *= -WALL_BOUNCE_RESTITUTION;
              state.velocity.x *= 0.92;
              state.angularVelocity.y *= 0.9;
            }

            state.tumbleEuler.set(
              state.angularVelocity.x * dt,
              state.angularVelocity.y * dt,
              state.angularVelocity.z * dt,
            );
            state.spinQuaternion.setFromEuler(state.tumbleEuler);
            state.quaternion.multiply(state.spinQuaternion).normalize();

            const angularDrag = state.position.y <= DIE_REST_Y + 0.001 ? 0.79 : 0.965;
            state.angularVelocity.multiplyScalar(angularDrag);

            if (state.position.y <= DIE_REST_Y) {
              state.position.y = DIE_REST_Y;

              const impactSpeed = Math.abs(state.velocity.y);
              if (impactSpeed > 0.35 && state.bounceCount < 3) {
                state.velocity.y = impactSpeed * (ROLL_BOUNCE_RESTITUTION / (1 + state.bounceCount * 0.45));
              } else {
                state.velocity.y = 0;
              }

              state.velocity.x *= 0.82;
              state.velocity.z *= 0.82;
              state.angularVelocity.x *= 0.72;
              state.angularVelocity.y *= 0.84;
              state.angularVelocity.z *= 0.72;
              state.bounceCount += 1;
            }

            const alignStrength =
              (0.03 + alignmentWindow * 0.11 + state.bounceCount * 0.025) * (state.position.y <= DIE_REST_Y + 0.001 ? 1.2 : 0.45);
            state.quaternion.slerp(state.targetQuaternion, 1 - Math.exp(-alignStrength * dt * 60));

            if (progress >= ROLL_FINAL_LOCK_PROGRESS) {
              state.velocity.lerp(ZERO_VECTOR, 1 - Math.exp(-9.5 * dt));
              state.angularVelocity.lerp(ZERO_VECTOR, 1 - Math.exp(-11 * dt));
              state.quaternion.slerp(state.targetQuaternion, 1 - Math.exp(-12 * dt));
            }

            if (
              progress >= ROLL_FINAL_LOCK_PROGRESS &&
              state.velocity.lengthSq() < 0.0025 &&
              state.angularVelocity.lengthSq() < 0.02
            ) {
              state.settled = true;
              state.quaternion.copy(state.targetQuaternion);
              state.velocity.copy(ZERO_VECTOR);
              state.angularVelocity.copy(ZERO_VECTOR);
            }
          }

          const groundCompression =
            state.position.y <= DIE_REST_Y + 0.012
              ? Math.min(Math.abs(state.velocity.y) * 0.012, 0.035)
              : 0;
          die.position.copy(state.position);
          die.quaternion.copy(state.quaternion);
          die.scale.set(
            1 + groundCompression * 0.28,
            1 - groundCompression,
            1 + groundCompression * 0.28,
          );
        });

        this.resolveDieCollisions(states, playBounds);

        if (progress >= ROLL_FINAL_LOCK_PROGRESS) {
          this.relaxRestingStates(states, playBounds, 2);
        }

        this.diceMeshes.forEach((die, index) => {
          const state = states[index];
          if (!state) {
            return;
          }

          die.position.copy(state.position);
          die.quaternion.copy(state.quaternion);
        });
        this.updateDynamicOverlays(performance.now());
      });

      const finalPositions: Vector3[] = [];
      const finalRotations: Vector3[] = [];
      finalValues.forEach((value, index) => {
        const die = this.diceMeshes[index];
        const state = states[index];

        if (!die || !state) {
          return;
        }

        const finalPosition = state.position.clone();
        finalPosition.y = DIE_REST_Y;
        finalPosition.x = MathUtils.clamp(finalPosition.x, playBounds.minX, playBounds.maxX);
        finalPosition.z = MathUtils.clamp(finalPosition.z, playBounds.minZ, playBounds.maxZ);
        const finalRotation = new Euler().setFromQuaternion(state.quaternion, 'XYZ');

        die.position.copy(finalPosition);
        die.quaternion.copy(state.quaternion);
        die.scale.setScalar(1);
        die.userData.basePosition = finalPosition.clone();
        die.userData.baseRotation = new Vector3(finalRotation.x, finalRotation.y, finalRotation.z);
        this.setDieOpacity(die, 1);
        this.setDieTopValue(die, value);
        finalPositions.push(finalPosition);
        finalRotations.push(new Vector3(finalRotation.x, finalRotation.y, finalRotation.z));
      });

      this.restLayout = cloneRestLayout({
        count: finalValues.length,
        positions: finalPositions,
        rotations: finalRotations,
      });

      this.updateDieHighlights();
    });
  }

  playTakeSelectionAnimation(selectedIndices: number[]): Promise<void> {
    return this.enqueueTransition(async () => {
      if (selectedIndices.length === 0 || this.diceMeshes.length === 0) {
        this.setDiceValues([]);
        return;
      }

      const selected = new Set(selectedIndices);
      const states = this.diceMeshes.map<TakeAnimationState>((die, index) => {
        const order = selectedIndices.indexOf(index);
        const isSelected = selected.has(index);
        const startPosition = die.position.clone();
        const targetPosition = isSelected
          ? new Vector3(-4.55 + order * 0.74, 0.48 + order * 0.03, 4.15 + order * 0.08)
          : new Vector3(startPosition.x * 0.45, 0.34, startPosition.z + 1.55);

        return {
          startPosition,
          targetPosition,
          startRotation: new Vector3(die.rotation.x, die.rotation.y, die.rotation.z),
          spinRotation: new Vector3(
            isSelected ? randomSpin() * 0.45 : randomSpin() * 0.18,
            isSelected ? randomSpin() * 0.45 : randomSpin() * 0.12,
            isSelected ? randomSpin() * 0.35 : randomSpin() * 0.08,
          ),
          startScale: die.scale.x,
          targetScale: isSelected ? 0.62 : 0.82,
          selected: isSelected,
        };
      });

      await this.animate(TAKE_DURATION_MS, (progress) => {
        const eased = easeInOutCubic(progress);

        this.diceMeshes.forEach((die, index) => {
          const state = states[index];
          if (!state) {
            return;
          }

          die.position.lerpVectors(state.startPosition, state.targetPosition, eased);
          die.rotation.set(
            MathUtils.lerp(state.startRotation.x, state.startRotation.x + state.spinRotation.x, eased),
            MathUtils.lerp(state.startRotation.y, state.startRotation.y + state.spinRotation.y, eased),
            MathUtils.lerp(state.startRotation.z, state.startRotation.z + state.spinRotation.z, eased),
          );
          die.scale.setScalar(MathUtils.lerp(state.startScale, state.targetScale, eased));
          this.setDieOpacity(die, state.selected ? 1 - eased * 0.92 : 1 - eased);
        });
        this.updateDynamicOverlays(performance.now());
      });

      this.selectedIndices.clear();
      this.setDiceValues([]);
    });
  }

  private enqueueTransition(task: () => Promise<void>): Promise<void> {
    const run = async () => {
      if (this.disposed) {
        return;
      }

      this.transitionActive = true;
      try {
        await task();
      } finally {
        this.transitionActive = false;
        this.updateDynamicOverlays(performance.now());
      }
    };

    const scheduled = this.transitionQueue.then(run, run);
    this.transitionQueue = scheduled.catch(() => {});
    return scheduled;
  }

  private animate(
    durationMs: number,
    step: (progress: number, deltaMs: number, elapsedMs: number) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      let previousTime = startTime;

      const frame = (timestamp: number) => {
        if (this.disposed) {
          resolve();
          return;
        }

        const elapsedMs = timestamp - startTime;
        const deltaMs = timestamp - previousTime;
        previousTime = timestamp;
        const progress = Math.min(elapsedMs / durationMs, 1);
        step(progress, deltaMs, elapsedMs);

        if (progress < 1) {
          window.requestAnimationFrame(frame);
          return;
        }

        resolve();
      };

      window.requestAnimationFrame(frame);
    });
  }

  private rebuildDice(values: number[]): void {
    this.clearDice();
    this.hoveredIndex = null;
    const { positions, rotations } = this.prepareRestLayout(values.length);

    values.forEach((value, index) => {
      const die = this.createDie(value);
      const selectionRing = this.createSelectionRing();
      const shadowMesh = this.createContactShadow();
      const basePosition = positions[index] ?? new Vector3(0, DIE_REST_Y, 0);
      const baseRotation = rotations[index] ?? new Vector3();

      die.position.copy(basePosition);
      die.rotation.set(baseRotation.x, baseRotation.y, baseRotation.z);
      die.userData.index = index;
      die.userData.basePosition = basePosition.clone();
      die.userData.baseRotation = baseRotation.clone();
      die.userData.selectionRing = selectionRing;
      die.userData.shadowMesh = shadowMesh;
      die.userData.topValue = value;
      this.setDieOpacity(die, 1);
      this.diceGroup.add(shadowMesh);
      this.diceGroup.add(selectionRing);
      this.diceGroup.add(die);
      this.diceMeshes.push(die);
    });

    this.updateDieHighlights();
  }

  private readonly handleResize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    if (width === 0 || height === 0) {
      return;
    }

    this.camera.aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.updateCameraFrame();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.interactive || this.diceMeshes.length === 0 || !this.dieClickHandler) {
      return;
    }

    const hit = this.pickDie(event.clientX, event.clientY);

    if (!hit) {
      return;
    }

    const index = hit.object.userData.index as number | undefined;

    if (typeof index === 'number') {
      this.dieClickHandler(index);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.interactive || this.diceMeshes.length === 0) {
      return;
    }

    const hit = this.pickDie(event.clientX, event.clientY);
    const index = typeof hit?.object.userData.index === 'number' ? (hit.object.userData.index as number) : null;

    if (this.hoveredIndex !== index) {
      this.hoveredIndex = index;
      this.updateDieHighlights();
    }

    this.refreshCursor();
  };

  private readonly handlePointerLeave = (): void => {
    if (this.hoveredIndex === null) {
      this.refreshCursor();
      return;
    }

    this.hoveredIndex = null;
    this.updateDieHighlights();
    this.refreshCursor();
  };

  private clearDice(): void {
    this.hoveredIndex = null;
    for (const die of this.diceMeshes) {
      const selectionRing = die.userData.selectionRing as SelectionRingMesh | undefined;
      if (selectionRing) {
        this.diceGroup.remove(selectionRing);
        selectionRing.geometry.dispose();
        selectionRing.material.dispose();
      }

      const shadowMesh = die.userData.shadowMesh as ContactShadowMesh | undefined;
      if (shadowMesh) {
        this.diceGroup.remove(shadowMesh);
        shadowMesh.geometry.dispose();
        shadowMesh.material.dispose();
      }

      this.diceGroup.remove(die);
      die.geometry.dispose();
      die.material.forEach((material: MeshStandardMaterial) => {
        material.map?.dispose();
        material.dispose();
      });
    }

    this.diceMeshes = [];
  }

  private resolveDieCollisions(states: RollAnimationState[], playBounds: PlayBounds): void {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
        const left = states[leftIndex];

        for (let rightIndex = leftIndex + 1; rightIndex < states.length; rightIndex += 1) {
          const right = states[rightIndex];
          const verticalGap = Math.abs(left.position.y - right.position.y);

          if (verticalGap > DIE_COLLISION_HEIGHT) {
            continue;
          }

          const deltaX = right.position.x - left.position.x;
          const deltaZ = right.position.z - left.position.z;
          const distanceSq = deltaX * deltaX + deltaZ * deltaZ;

          if (distanceSq >= DIE_COLLISION_DISTANCE * DIE_COLLISION_DISTANCE) {
            continue;
          }

          const distance = Math.sqrt(Math.max(distanceSq, 1e-6));
          const normalX = distance > 1e-5 ? deltaX / distance : Math.cos((leftIndex + rightIndex + 1) * 1.618);
          const normalZ = distance > 1e-5 ? deltaZ / distance : Math.sin((leftIndex + rightIndex + 1) * 1.618);
          const overlap = DIE_COLLISION_DISTANCE - distance;
          const correction = overlap * 0.5;

          left.position.x -= normalX * correction;
          left.position.z -= normalZ * correction;
          right.position.x += normalX * correction;
          right.position.z += normalZ * correction;

          this.clampStateToBounds(left, playBounds);
          this.clampStateToBounds(right, playBounds);

          const relativeVelocityX = right.velocity.x - left.velocity.x;
          const relativeVelocityZ = right.velocity.z - left.velocity.z;
          const separatingSpeed = relativeVelocityX * normalX + relativeVelocityZ * normalZ;

          if (separatingSpeed < 0) {
            const impulse = -(1 + 0.16) * separatingSpeed * 0.5;
            left.velocity.x -= normalX * impulse;
            left.velocity.z -= normalZ * impulse;
            right.velocity.x += normalX * impulse;
            right.velocity.z += normalZ * impulse;
          }

          left.velocity.x -= normalX * overlap * 0.75;
          left.velocity.z -= normalZ * overlap * 0.75;
          right.velocity.x += normalX * overlap * 0.75;
          right.velocity.z += normalZ * overlap * 0.75;
          left.angularVelocity.y += overlap * 1.8;
          right.angularVelocity.y -= overlap * 1.8;
        }
      }
    }
  }

  private relaxRestingStates(states: RollAnimationState[], playBounds: PlayBounds, maxIterations = 14): void {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let moved = false;

      for (let leftIndex = 0; leftIndex < states.length; leftIndex += 1) {
        const left = states[leftIndex];

        for (let rightIndex = leftIndex + 1; rightIndex < states.length; rightIndex += 1) {
          const right = states[rightIndex];
          const deltaX = right.position.x - left.position.x;
          const deltaZ = right.position.z - left.position.z;
          const distanceSq = deltaX * deltaX + deltaZ * deltaZ;

          if (distanceSq >= DIE_COLLISION_DISTANCE * DIE_COLLISION_DISTANCE) {
            continue;
          }

          const distance = Math.sqrt(Math.max(distanceSq, 1e-6));
          const normalX = distance > 1e-5 ? deltaX / distance : Math.cos((leftIndex + rightIndex + 1) * 1.618);
          const normalZ = distance > 1e-5 ? deltaZ / distance : Math.sin((leftIndex + rightIndex + 1) * 1.618);
          const overlap = DIE_COLLISION_DISTANCE - distance;
          const correction = overlap * 0.5;

          left.position.x -= normalX * correction;
          left.position.z -= normalZ * correction;
          right.position.x += normalX * correction;
          right.position.z += normalZ * correction;

          this.clampStateToBounds(left, playBounds);
          this.clampStateToBounds(right, playBounds);
          moved = true;
        }
      }

      if (!moved) {
        break;
      }
    }
  }

  private clampStateToBounds(state: RollAnimationState, playBounds: PlayBounds): void {
    state.position.x = MathUtils.clamp(state.position.x, playBounds.minX, playBounds.maxX);
    state.position.z = MathUtils.clamp(state.position.z, playBounds.minZ, playBounds.maxZ);
    state.position.y = Math.max(state.position.y, DIE_REST_Y);
  }

  private prepareRestLayout(count: number, refresh = false): RestLayout {
    if (count === 0) {
      this.restLayout = null;
      return { count: 0, positions: [], rotations: [] };
    }

    if (!refresh && this.restLayout && this.restLayout.count === count) {
      return cloneRestLayout(this.restLayout);
    }

    const layout = this.generateRestLayout(count);
    this.restLayout = cloneRestLayout(layout);
    return layout;
  }

  private getPlayBounds(): PlayBounds {
    return {
      minX: -(TRAY_WIDTH * 0.5 - TRAY_WALL_THICKNESS - PLAY_AREA_MARGIN),
      maxX: TRAY_WIDTH * 0.5 - TRAY_WALL_THICKNESS - PLAY_AREA_MARGIN,
      minZ: -(TRAY_DEPTH * 0.5 - TRAY_WALL_THICKNESS - PLAY_AREA_MARGIN),
      maxZ: TRAY_DEPTH * 0.5 - TRAY_WALL_THICKNESS - PLAY_AREA_MARGIN,
    };
  }

  private generateRestLayout(count: number): RestLayout {
    const positions: Vector3[] = [];
    const rotations: Vector3[] = [];
    const playBounds = this.getPlayBounds();
    const baseSpreadX = TRAY_WIDTH * 0.1 + Math.min(count, 6) * 0.06;
    const baseSpreadZ = TRAY_DEPTH * 0.075 + Math.min(count, 6) * 0.05;
    let minimumSpacing = count >= 5 ? 1.36 : 1.28;

    for (let round = 0; round < 3 && positions.length < count; round += 1) {
      let attempts = 0;
      const spreadX = baseSpreadX * (1 + round * 0.16);
      const spreadZ = baseSpreadZ * (1 + round * 0.16);

      while (positions.length < count && attempts < 520) {
        attempts += 1;
        const candidate = new Vector3(
          MathUtils.clamp(sampleCenteredOffset(spreadX), playBounds.minX, playBounds.maxX),
          DIE_REST_Y,
          MathUtils.clamp(REST_LAYOUT_CENTER_Z + sampleCenteredOffset(spreadZ), playBounds.minZ, playBounds.maxZ),
        );

        if (positions.every((position) => position.distanceTo(candidate) >= minimumSpacing)) {
          positions.push(candidate);
          rotations.push(new Vector3(0, randomSignedRange(Math.PI * 0.04, Math.PI * 0.92), 0));
        }
      }

      minimumSpacing -= 0.06;
    }

    if (positions.length < count) {
      const fallbackPositions = this.layoutDicePositions(count).map(
        (position) =>
          new Vector3(
            MathUtils.clamp(position.x * 0.58 + randomSignedRange(0.04, 0.12), playBounds.minX, playBounds.maxX),
            DIE_REST_Y,
            MathUtils.clamp(
              REST_LAYOUT_CENTER_Z + position.z * 0.54 + randomSignedRange(0.03, 0.1),
              playBounds.minZ,
              playBounds.maxZ,
            ),
          ),
      );
      const fallbackRotations = fallbackPositions.map(
        () => new Vector3(0, randomSignedRange(Math.PI * 0.04, Math.PI * 0.92), 0),
      );
      return {
        count,
        positions: fallbackPositions,
        rotations: fallbackRotations,
      };
    }

    return { count, positions, rotations };
  }

  private setDieTopValue(die: DieMesh, topValue: number): void {
    if (die.userData.topValue === topValue) {
      return;
    }

    const nextMaterials = this.buildDieMaterials(topValue);
    die.material.forEach((material: MeshStandardMaterial) => {
      material.map?.dispose();
      material.dispose();
    });
    die.material = nextMaterials;
    die.userData.topValue = topValue;
  }

  private setDieOpacity(die: DieMesh, opacity: number): void {
    die.material.forEach((material: MeshStandardMaterial) => {
      material.transparent = opacity < 0.999;
      material.opacity = opacity;
      material.needsUpdate = true;
    });
  }

  private updateDieHighlights(): void {
    const pulseTime = performance.now();

    this.diceMeshes.forEach((die, index) => {
      const selected = this.selectedIndices.has(index);
      const hovered = this.interactive && this.hoveredIndex === index && !selected;
      const basePosition = die.userData.basePosition as Vector3;
      const selectionRing = die.userData.selectionRing as SelectionRingMesh | undefined;
      const pulse = selected ? (Math.sin(pulseTime * RING_PULSE_SPEED + index * 0.55) + 1) * 0.5 : 0;

      if (!this.transitionActive) {
        die.position.copy(basePosition);
        die.position.y += selected ? SELECTED_LIFT : hovered ? HOVER_LIFT : 0;
        die.scale.setScalar(selected ? 1.04 + pulse * 0.018 : hovered ? 1.02 : 1);
      }

      die.material.forEach((material: MeshStandardMaterial) => {
        material.emissive.set(selected ? '#8c6e1f' : hovered ? '#6e5d26' : '#000000');
        material.emissiveIntensity = selected ? 0.28 : hovered ? 0.12 : 0;
      });

      if (selectionRing) {
        selectionRing.visible = selected;
        selectionRing.material.opacity = 0.72 + pulse * 0.18;
      }
    });

    this.refreshCursor();
    this.updateDynamicOverlays(pulseTime);
  }

  private createLights(): void {
    const hemisphere = new HemisphereLight('#fff8ee', '#7c8664', 1.15);
    this.scene.add(hemisphere);

    const ambient = new AmbientLight('#ffffff', 0.55);
    this.scene.add(ambient);

    const keyLight = new DirectionalLight('#fff7df', 1.65);
    keyLight.position.set(5.5, 11, 4.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -16;
    keyLight.shadow.camera.right = 16;
    keyLight.shadow.camera.top = 16;
    keyLight.shadow.camera.bottom = -16;
    keyLight.shadow.bias = -0.00012;
    this.scene.add(keyLight);
  }

  private createEnvironment(): void {
    const table = new Mesh(
      new PlaneGeometry(46, 38),
      new MeshStandardMaterial({
        color: '#d3c5af',
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.01;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private createTray(): void {
    const trayGroup = new Group();

    const felt = new Mesh(
      new BoxGeometry(TRAY_WIDTH, TRAY_FELT_HEIGHT, TRAY_DEPTH),
      new MeshStandardMaterial({
        color: '#607338',
        roughness: 0.96,
        metalness: 0.02,
      }),
    );
    felt.position.y = TRAY_FELT_CENTER_Y;
    felt.receiveShadow = true;
    trayGroup.add(felt);

    const woodMaterial = new MeshStandardMaterial({
      color: '#8c5d34',
      roughness: 0.68,
      metalness: 0.06,
    });

    const leftWall = new Mesh(
      new BoxGeometry(TRAY_WALL_THICKNESS, TRAY_WALL_HEIGHT, TRAY_DEPTH + TRAY_WALL_THICKNESS),
      woodMaterial,
    );
    leftWall.position.set(-(TRAY_WIDTH + TRAY_WALL_THICKNESS) / 2, TRAY_WALL_HEIGHT / 2, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    trayGroup.add(leftWall);

    const rightWall = leftWall.clone();
    rightWall.position.x *= -1;
    trayGroup.add(rightWall);

    const topWall = new Mesh(
      new BoxGeometry(TRAY_WIDTH, TRAY_WALL_HEIGHT, TRAY_WALL_THICKNESS),
      woodMaterial,
    );
    topWall.position.set(0, TRAY_WALL_HEIGHT / 2, -(TRAY_DEPTH + TRAY_WALL_THICKNESS) / 2);
    topWall.castShadow = true;
    topWall.receiveShadow = true;
    trayGroup.add(topWall);

    const bottomWall = topWall.clone();
    bottomWall.position.z *= -1;
    trayGroup.add(bottomWall);

    this.scene.add(trayGroup);
  }

  private createDie(topValue: number): DieMesh {
    const geometry = new BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    const materials = this.buildDieMaterials(topValue);
    const die = new Mesh(geometry, materials);
    die.castShadow = true;
    die.receiveShadow = true;
    return die;
  }

  private createSelectionRing(): SelectionRingMesh {
    const ring = new Mesh(
      new RingGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.84, 48),
      new MeshBasicMaterial({
        color: '#d7aa42',
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 2;
    return ring;
  }

  private createContactShadow(): ContactShadowMesh {
    const shadow = new Mesh(
      new CircleGeometry(DIE_SIZE * 0.58, 40),
      new MeshBasicMaterial({
        color: '#233014',
        transparent: true,
        opacity: SHADOW_MAX_OPACITY,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = SHADOW_Y;
    shadow.renderOrder = 1;
    return shadow;
  }

  private updateDynamicOverlays(timeMs: number): void {
    this.diceMeshes.forEach((die, index) => {
      const selected = this.selectedIndices.has(index);
      const hovered = this.interactive && this.hoveredIndex === index && !selected;
      const pulse = selected ? (Math.sin(timeMs * RING_PULSE_SPEED + index * 0.55) + 1) * 0.5 : 0;
      const selectionRing = die.userData.selectionRing as SelectionRingMesh | undefined;
      const shadowMesh = die.userData.shadowMesh as ContactShadowMesh | undefined;

      if (selectionRing) {
        selectionRing.visible = selected;
        selectionRing.position.set(die.position.x, SHADOW_Y + 0.002, die.position.z);
        selectionRing.scale.setScalar(1 + pulse * 0.08);
      }

      if (shadowMesh) {
        const heightOffset = Math.max(0, die.position.y - DIE_REST_Y);
        const heightFactor = MathUtils.clamp(heightOffset / 3.4, 0, 1);
        const compression = MathUtils.clamp((1 - die.scale.y) * 6.5, 0, 1);
        const emphasis = selected ? 0.05 : hovered ? 0.025 : 0;

        shadowMesh.position.set(die.position.x, SHADOW_Y, die.position.z);
        shadowMesh.scale.setScalar(
          SHADOW_BASE_SCALE + heightFactor * 0.52 - compression * 0.14 + (selected ? 0.06 : hovered ? 0.03 : 0),
        );
        shadowMesh.material.opacity = MathUtils.clamp(
          SHADOW_MAX_OPACITY - heightFactor * 0.14 + compression * 0.08 + emphasis,
          SHADOW_MIN_OPACITY,
          SHADOW_MAX_OPACITY + 0.03,
        );
      }
    });
  }

  private pickDie(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.diceMeshes, false);
    return intersections[0] ?? null;
  }

  private refreshCursor(): void {
    this.canvas.style.cursor = this.interactive && this.hoveredIndex !== null ? 'pointer' : 'default';
  }

  private updateCameraFrame(): void {
    const target = new Vector3(0, TRAY_FELT_CENTER_Y + TRAY_FELT_HEIGHT * 0.5, 0);
    const direction = new Vector3(0, 1, CAMERA_FORWARD_OFFSET).normalize();
    this.camera.fov = CAMERA_FOV;

    let minDistance = CAMERA_MIN_DISTANCE;
    let maxDistance = CAMERA_MAX_DISTANCE;

    for (let iteration = 0; iteration < 24; iteration += 1) {
      const candidateDistance = (minDistance + maxDistance) * 0.5;
      this.camera.position.copy(target).addScaledVector(direction, candidateDistance);
      this.camera.lookAt(target);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();

      if (this.isTrayFullyVisible(CAMERA_FRAME_MARGIN)) {
        maxDistance = candidateDistance;
      } else {
        minDistance = candidateDistance;
      }
    }

    this.camera.position.copy(target).addScaledVector(direction, maxDistance);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private isTrayFullyVisible(frameMargin: number): boolean {
    const halfWidth = (TRAY_WIDTH + TRAY_WALL_THICKNESS) * 0.5;
    const halfDepth = (TRAY_DEPTH + TRAY_WALL_THICKNESS) * 0.5;
    const topY = TRAY_WALL_HEIGHT + 0.04;
    const corners = [
      new Vector3(-halfWidth, topY, -halfDepth),
      new Vector3(halfWidth, topY, -halfDepth),
      new Vector3(-halfWidth, topY, halfDepth),
      new Vector3(halfWidth, topY, halfDepth),
    ];

    return corners.every((corner) => {
      const projected = corner.clone().project(this.camera);
      return (
        Number.isFinite(projected.x) &&
        Number.isFinite(projected.y) &&
        Number.isFinite(projected.z) &&
        Math.abs(projected.x) <= frameMargin &&
        Math.abs(projected.y) <= frameMargin
      );
    });
  }

  private buildDieMaterials(topValue: number): MeshStandardMaterial[] {
    const faceValues = this.getFaceValuesForTop(topValue);

    return [
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.px), roughness: 0.52, metalness: 0.05 }),
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.nx), roughness: 0.52, metalness: 0.05 }),
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.py), roughness: 0.52, metalness: 0.05 }),
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.ny), roughness: 0.52, metalness: 0.05 }),
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.pz), roughness: 0.52, metalness: 0.05 }),
      new MeshStandardMaterial({ map: createFaceTexture(faceValues.nz), roughness: 0.52, metalness: 0.05 }),
    ];
  }

  private getFaceValuesForTop(topValue: number): Record<DieFace, number> {
    const layouts: Record<number, Record<DieFace, number>> = {
      1: { px: 3, nx: 4, py: 1, ny: 6, pz: 2, nz: 5 },
      2: { px: 1, nx: 6, py: 2, ny: 5, pz: 3, nz: 4 },
      3: { px: 2, nx: 5, py: 3, ny: 4, pz: 6, nz: 1 },
      4: { px: 5, nx: 2, py: 4, ny: 3, pz: 1, nz: 6 },
      5: { px: 4, nx: 3, py: 5, ny: 2, pz: 1, nz: 6 },
      6: { px: 4, nx: 3, py: 6, ny: 1, pz: 5, nz: 2 },
    };

    return layouts[MathUtils.clamp(topValue, 1, 6)];
  }

  private layoutDicePositions(count: number): Vector3[] {
    if (count === 0) {
      return [];
    }

    const columns = count <= 3 ? count : Math.min(3, count);
    const horizontalSpacing = 2.15;
    const verticalSpacing = 2.2;

    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowCount = Math.ceil(count / columns);
      const rowSize = row === rowCount - 1 ? count - row * columns || columns : columns;
      const xOffset = (rowSize - 1) * horizontalSpacing * 0.5;
      const zOffset = (rowCount - 1) * verticalSpacing * 0.5;
      return new Vector3(
        column * horizontalSpacing - xOffset,
        DIE_REST_Y,
        row * verticalSpacing - zOffset,
      );
    });
  }

}

function createFaceTexture(value: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Unable to get 2D context for die face texture');
  }

  ctx.fillStyle = '#f6f1e7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#dfd1ba';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

  ctx.fillStyle = '#2c241a';

  const centers = {
    tl: [64, 64],
    tc: [128, 64],
    tr: [192, 64],
    ml: [64, 128],
    mc: [128, 128],
    mr: [192, 128],
    bl: [64, 192],
    bc: [128, 192],
    br: [192, 192],
  } as const;

  const layouts: Record<number, Array<keyof typeof centers>> = {
    1: ['mc'],
    2: ['tl', 'br'],
    3: ['tl', 'mc', 'br'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'mc', 'bl', 'br'],
    6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
  };

  layouts[value].forEach((key) => {
    const [x, y] = centers[key];
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomSignedRange(min: number, max: number): number {
  return randomRange(min, max) * (Math.random() > 0.5 ? 1 : -1);
}

function sampleCenteredOffset(radius: number): number {
  const blended =
    (Math.random() - 0.5) * 0.55 +
    (Math.random() - 0.5) * 0.3 +
    (Math.random() - 0.5) * 0.15;
  return blended * radius * 2;
}

function randomSpin(): number {
  const fullTurns = randomRange(2.6, 4.8) * Math.PI;
  return Math.random() > 0.5 ? fullTurns : -fullTurns;
}

function cloneRestLayout(layout: RestLayout): RestLayout {
  return {
    count: layout.count,
    positions: layout.positions.map((position) => position.clone()),
    rotations: layout.rotations.map((rotation) => rotation.clone()),
  };
}
