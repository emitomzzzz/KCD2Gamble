import {
  bankCurrentTurn,
  continuePlaying,
  getGame,
  newGame,
  previewSelection,
  resolveFarkleTurn,
  rollDice,
  takeSelection,
} from '../api/gameApi';
import { TrayScene } from '../scene/TrayScene';
import type { GameActionResponse, GameSnapshot, PreviewPayload } from '../types/game';

interface ElementMap {
  targetInput: HTMLInputElement;
  setupOverlay: HTMLElement;
  setupForm: HTMLElement;
  newGameButton: HTMLButtonElement;
  victoryNewGameButton: HTMLButtonElement;
  statusPanel: HTMLElement;
  actionPanel: HTMLElement;
  rollButton: HTMLButtonElement;
  bankButton: HTMLButtonElement;
  connectionBadge: HTMLElement;
  headerA: HTMLElement;
  headerB: HTMLElement;
  scoreA: HTMLElement;
  scoreB: HTMLElement;
  targetScoreDisplay: HTMLElement;
  roundScoreA: HTMLElement;
  roundScoreB: HTMLElement;
  selectedScoreA: HTMLElement;
  selectedScoreB: HTMLElement;
  phaseBanner: HTMLElement;
  centerNotice: HTMLElement;
  victoryOverlay: HTMLElement;
  confettiLayer: HTMLElement;
  victoryTitle: HTMLElement;
  victoryWinner: HTMLElement;
  victoryScoreA: HTMLElement;
  victoryScoreB: HTMLElement;
  victoryTarget: HTMLElement;
}

interface ActionOptions {
  pendingMessage?: string;
  resetSelection?: boolean;
  onSuccess?: (response: GameActionResponse) => Promise<void>;
}

const CONFETTI_COLORS = ['#f0c662', '#dd7d56', '#6aa9d7', '#7bb66f', '#c86bb1', '#f4e8bf'];

export class GameApp {
  private readonly elements: ElementMap;
  private readonly scene: TrayScene;
  private snapshot: GameSnapshot | null = null;
  private preview: PreviewPayload | null = null;
  private selectedIndices: number[] = [];
  private busy = false;
  private presentationBusy = false;
  private hudVisible = false;
  private setupVisible = true;
  private previewToken = 0;
  private bannerTimeoutId: number | null = null;
  private confettiCleanupId: number | null = null;
  private presentedVictoryKey: string | null = null;

  constructor(root: HTMLElement, scene: TrayScene) {
    this.scene = scene;
    this.elements = this.collectElements(root);
    this.bindEvents();
    this.scene.setDieClickHandler((index) => {
      void this.toggleDie(index);
    });
  }

  async init(): Promise<void> {
    try {
      const response = await getGame();
      this.markConnection(true);
      this.elements.targetInput.value = `${response.snapshot.target_score ?? 5000}`;
    } catch (error) {
      this.markConnection(false);
      this.showBanner(this.describeError(error), 'warn');
    }

    this.scene.setDiceValues([]);
    this.scene.clearTakenDice();
    this.render();
  }

  dispose(): void {
    this.scene.setDieClickHandler(null);
    this.clearBannerTimer();
    this.clearConfettiTimer();
  }

  private collectElements(root: HTMLElement): ElementMap {
    const query = <T extends HTMLElement>(selector: string): T => {
      const element = root.querySelector<T>(selector);

      if (!element) {
        throw new Error(`Missing element: ${selector}`);
      }

      return element;
    };

    return {
      targetInput: query<HTMLInputElement>('#target-score'),
      setupOverlay: query<HTMLElement>('#setup-overlay'),
      setupForm: query<HTMLElement>('#setup-form'),
      newGameButton: query<HTMLButtonElement>('#new-game-button'),
      victoryNewGameButton: query<HTMLButtonElement>('#victory-new-game-button'),
      statusPanel: query<HTMLElement>('#status-panel'),
      actionPanel: query<HTMLElement>('#action-panel'),
      rollButton: query<HTMLButtonElement>('#roll-button'),
      bankButton: query<HTMLButtonElement>('#bank-button'),
      connectionBadge: query<HTMLElement>('#connection-badge'),
      headerA: query<HTMLElement>('#header-a'),
      headerB: query<HTMLElement>('#header-b'),
      scoreA: query<HTMLElement>('#score-a'),
      scoreB: query<HTMLElement>('#score-b'),
      targetScoreDisplay: query<HTMLElement>('#target-score-display'),
      roundScoreA: query<HTMLElement>('#round-score-a'),
      roundScoreB: query<HTMLElement>('#round-score-b'),
      selectedScoreA: query<HTMLElement>('#selected-score-a'),
      selectedScoreB: query<HTMLElement>('#selected-score-b'),
      phaseBanner: query<HTMLElement>('#phase-banner'),
      centerNotice: query<HTMLElement>('#center-notice'),
      victoryOverlay: query<HTMLElement>('#victory-overlay'),
      confettiLayer: query<HTMLElement>('#confetti-layer'),
      victoryTitle: query<HTMLElement>('#victory-title'),
      victoryWinner: query<HTMLElement>('#victory-winner'),
      victoryScoreA: query<HTMLElement>('#victory-score-a'),
      victoryScoreB: query<HTMLElement>('#victory-score-b'),
      victoryTarget: query<HTMLElement>('#victory-target'),
    };
  }

  private bindEvents(): void {
    this.elements.newGameButton.addEventListener('click', () => {
      void this.handleNewGame();
    });
    this.elements.victoryNewGameButton.addEventListener('click', () => {
      this.hudVisible = false;
      this.openSetupOverlay();
      this.hideVictoryOverlay();
      this.clearConfetti();
      this.render();
    });
    this.elements.rollButton.addEventListener('click', () => {
      void this.handlePrimaryAction();
    });
    this.elements.bankButton.addEventListener('click', () => {
      void this.handleSaveAndEndTurn();
    });
  }

  private get uiBusy(): boolean {
    return this.busy || this.presentationBusy;
  }

  private markConnection(connected: boolean): void {
    this.elements.connectionBadge.textContent = connected ? '后端已连接' : '后端未连接';
    this.elements.connectionBadge.classList.toggle('badge-online', connected);
    this.elements.connectionBadge.classList.toggle('badge-offline', !connected);
  }

  private openSetupOverlay(): void {
    this.setupVisible = true;
    this.render();
  }

  private closeSetupOverlay(): void {
    this.setupVisible = false;
    this.render();
  }

  private async handleNewGame(): Promise<void> {
    if (this.uiBusy) {
      return;
    }

    const targetScore = Number.parseInt(this.elements.targetInput.value, 10);

    if (!Number.isInteger(targetScore) || targetScore <= 0) {
      this.showBanner('目标分数必须是正整数', 'warn');
      return;
    }

    await this.runAction(() => newGame({ target_score: targetScore }), {
      pendingMessage: '正在开始新对局...',
      onSuccess: async () => {
        this.hideVictoryOverlay();
        this.clearConfetti();
        this.hudVisible = true;
        this.closeSetupOverlay();
        await this.scene.transitionToPlayView();
      },
    });
  }

  private async handlePrimaryAction(): Promise<void> {
    const snapshot = this.snapshot;

    if (!snapshot || this.uiBusy || this.setupVisible) {
      return;
    }

    if (snapshot.phase === 'ready_to_roll') {
      await this.runBusyTask('正在掷骰...', async () => {
        const startingDice = snapshot.remaining_dice || 6;
        const response = await rollDice();
        this.markConnection(true);
        await this.scene.playRollAnimation(response.snapshot.current_roll, startingDice);
        const finalResponse = await this.resolveFarkleIfNeeded(response);
        this.applyResponse(finalResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'awaiting_selection') {
      if (!this.hasValidPreview()) {
        this.showBanner('请先选择有效的计分骰子', 'warn');
        this.render();
        return;
      }

      await this.runBusyTask('正在拿走已计分骰子并继续掷骰...', async () => {
        const selectedIndices = [...this.selectedIndices];
        const takeResponse = await takeSelection(selectedIndices);
        this.markConnection(true);
        await this.scene.playTakeSelectionAnimation(selectedIndices, takeResponse.take_result?.hot_dice ?? false);
        const continueResponse = await continuePlaying();
        this.markConnection(true);
        await this.scene.playRollAnimation(
          continueResponse.snapshot.current_roll,
          takeResponse.snapshot.remaining_dice,
        );
        const finalResponse = await this.resolveFarkleIfNeeded(continueResponse);
        this.applyResponse(finalResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'can_bank_or_continue') {
      await this.runBusyTask('正在继续掷剩余骰子...', async () => {
        const response = await continuePlaying();
        this.markConnection(true);
        await this.scene.playRollAnimation(response.snapshot.current_roll, snapshot.remaining_dice);
        const finalResponse = await this.resolveFarkleIfNeeded(response);
        this.applyResponse(finalResponse, true);
      });
    }
  }

  private async handleSaveAndEndTurn(): Promise<void> {
    const snapshot = this.snapshot;

    if (!snapshot || this.uiBusy || this.setupVisible) {
      return;
    }

    if (snapshot.phase === 'awaiting_selection') {
      if (!this.hasValidPreview()) {
        this.showBanner('请先选择有效的计分骰子', 'warn');
        this.render();
        return;
      }

      await this.runBusyTask('正在保存本回合分数...', async () => {
        const selectedIndices = [...this.selectedIndices];
        const takeResponse = await takeSelection(selectedIndices);
        this.markConnection(true);
        await this.scene.playTakeSelectionAnimation(selectedIndices, takeResponse.take_result?.hot_dice ?? false);
        const bankResponse = await bankCurrentTurn();
        this.markConnection(true);
        this.applyResponse(bankResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'can_bank_or_continue') {
      await this.runAction(() => bankCurrentTurn(), {
        pendingMessage: '正在保存本回合分数...',
      });
    }
  }

  private async toggleDie(index: number): Promise<void> {
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection' || this.uiBusy || this.setupVisible) {
      return;
    }

    const selected = new Set(this.selectedIndices);

    if (selected.has(index)) {
      selected.delete(index);
    } else {
      selected.add(index);
    }

    this.selectedIndices = Array.from(selected).sort((left, right) => left - right);
    this.preview = null;
    this.scene.setSelectedIndices(this.selectedIndices);
    this.render();

    if (this.selectedIndices.length === 0) {
      return;
    }

    const token = ++this.previewToken;

    try {
      const response = await previewSelection(this.selectedIndices);

      if (token !== this.previewToken) {
        return;
      }

      this.snapshot = response.snapshot;
      this.preview = response.preview ?? null;
    } catch (error) {
      if (token !== this.previewToken) {
        return;
      }

      this.preview = null;
      this.showBanner(this.describeError(error), 'warn');
    }

    this.render();
  }

  private async runAction(action: () => Promise<GameActionResponse>, options: ActionOptions = {}): Promise<void> {
    if (this.uiBusy) {
      return;
    }

    this.busy = true;

    if (options.pendingMessage) {
      this.showBanner(options.pendingMessage, 'info');
    }
    this.render();

    try {
      const response = await action();
      this.markConnection(true);
      if (options.onSuccess) {
        await options.onSuccess(response);
      }
      this.applyResponse(response, options.resetSelection ?? true);
    } catch (error) {
      this.markConnection(false);
      this.showBanner(this.describeError(error), 'warn');
      this.render();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async runBusyTask(pendingMessage: string, task: () => Promise<void>): Promise<void> {
    if (this.uiBusy) {
      return;
    }

    this.busy = true;
    this.showBanner(pendingMessage, 'info');
    this.render();

    try {
      await task();
    } catch (error) {
      this.markConnection(false);
      this.showBanner(this.describeError(error), 'warn');
      this.render();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private applyResponse(response: GameActionResponse, resetSelection: boolean): void {
    const previousSnapshot = this.snapshot;
    this.snapshot = response.snapshot;

    if (resetSelection || this.snapshot.phase !== 'awaiting_selection') {
      this.selectedIndices = [];
      this.preview = null;
      this.previewToken += 1;
    } else {
      this.preview = response.preview ?? this.preview;
    }

    if (
      response.message === 'Started a new game.' ||
      this.snapshot.phase === 'game_over' ||
      (previousSnapshot !== null && previousSnapshot.current_player !== this.snapshot.current_player)
    ) {
      this.scene.clearTakenDice();
    }

    if (response.message === 'Started a new game.' || this.snapshot.phase !== 'game_over') {
      this.presentedVictoryKey = null;
    }

    this.syncScene();
    void this.handleTransitions(previousSnapshot, this.snapshot, response.message);
    this.render();
  }

  private syncScene(): void {
    const diceValues = this.snapshot?.current_roll ?? [];
    this.scene.setDiceValues(diceValues);
    this.scene.setSelectedIndices(this.selectedIndices);
    this.scene.setInteractive(
      this.hudVisible && !this.setupVisible && this.snapshot?.phase === 'awaiting_selection' && !this.uiBusy,
    );
  }

  private render(): void {
    const snapshot = this.snapshot;
    const currentPlayer = snapshot?.current_player ?? 'A';
    const uiBusy = this.uiBusy;
    const roundScoreA = currentPlayer === 'A' ? snapshot?.turn_points ?? 0 : 0;
    const roundScoreB = currentPlayer === 'B' ? snapshot?.turn_points ?? 0 : 0;
    const selectedScoreA = currentPlayer === 'A' && this.preview?.is_valid ? this.preview.points : 0;
    const selectedScoreB = currentPlayer === 'B' && this.preview?.is_valid ? this.preview.points : 0;
    const canCommitSelection = snapshot?.phase === 'awaiting_selection' && this.hasValidPreview();
    const canPrimaryAct =
      !uiBusy &&
      this.hudVisible &&
      !this.setupVisible &&
      !!snapshot &&
      (snapshot.phase === 'ready_to_roll'
        ? snapshot.available_actions.roll
        : snapshot.phase === 'awaiting_selection'
          ? canCommitSelection
          : snapshot.phase === 'can_bank_or_continue'
            ? snapshot.available_actions.continue_turn
            : false);
    const canBankAct =
      !uiBusy &&
      this.hudVisible &&
      !this.setupVisible &&
      !!snapshot &&
      (snapshot.phase === 'awaiting_selection'
        ? canCommitSelection
        : snapshot.phase === 'can_bank_or_continue'
          ? snapshot.available_actions.bank_turn
          : false);

    this.elements.scoreA.textContent = `${snapshot?.scores.A ?? 0}`;
    this.elements.scoreB.textContent = `${snapshot?.scores.B ?? 0}`;
    this.elements.targetScoreDisplay.textContent = `${snapshot?.target_score ?? this.elements.targetInput.value}`;
    this.elements.roundScoreA.textContent = `${roundScoreA}`;
    this.elements.roundScoreB.textContent = `${roundScoreB}`;
    this.elements.selectedScoreA.textContent = `${selectedScoreA}`;
    this.elements.selectedScoreB.textContent = `${selectedScoreB}`;
    this.elements.headerA.classList.toggle('is-active', currentPlayer === 'A');
    this.elements.headerB.classList.toggle('is-active', currentPlayer === 'B');
    this.elements.roundScoreA.classList.toggle('is-active', currentPlayer === 'A');
    this.elements.roundScoreB.classList.toggle('is-active', currentPlayer === 'B');
    this.elements.selectedScoreA.classList.toggle('is-active', currentPlayer === 'A');
    this.elements.selectedScoreB.classList.toggle('is-active', currentPlayer === 'B');
    this.elements.rollButton.textContent = snapshot?.phase === 'ready_to_roll' || !snapshot ? '掷骰' : '继续掷骰';
    this.elements.newGameButton.disabled = uiBusy;
    this.elements.victoryNewGameButton.disabled = uiBusy;
    this.elements.rollButton.disabled = !canPrimaryAct;
    this.elements.bankButton.disabled = !canBankAct;
    this.elements.statusPanel.classList.toggle('is-hidden', !this.hudVisible);
    this.elements.actionPanel.classList.toggle('is-hidden', !this.hudVisible);
    this.elements.setupOverlay.classList.toggle('is-visible', this.setupVisible);
    this.elements.setupOverlay.setAttribute('aria-hidden', String(!this.setupVisible));
    this.elements.setupForm.classList.toggle('is-visible', this.setupVisible);
    this.elements.setupForm.setAttribute('aria-hidden', String(!this.setupVisible));
    this.scene.setInteractive(
      this.hudVisible && !this.setupVisible && snapshot?.phase === 'awaiting_selection' && !uiBusy,
    );
  }

  private hasValidPreview(): boolean {
    return this.selectedIndices.length > 0 && this.preview?.is_valid === true;
  }

  private async resolveFarkleIfNeeded(response: GameActionResponse): Promise<GameActionResponse> {
    if (response.snapshot.phase !== 'farkle') {
      return response;
    }

    this.hideBanner();
    await this.showCenterNotice('本轮作废！', 1000, 520);
    const resolved = await resolveFarkleTurn();
    this.markConnection(true);
    return resolved;
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, durationMs);
    });
  }

  private async handleTransitions(
    previousSnapshot: GameSnapshot | null,
    nextSnapshot: GameSnapshot,
    responseMessage: string,
  ): Promise<void> {
    if (nextSnapshot.phase === 'game_over') {
      await this.presentVictory(nextSnapshot);
      return;
    }

    if (responseMessage === 'Started a new game.') {
      this.showBanner('新对局已开始', 'info');
      return;
    }

    if (!previousSnapshot) {
      return;
    }

    if (previousSnapshot.current_player !== nextSnapshot.current_player) {
      this.showBanner(`轮到玩家 ${nextSnapshot.current_player}`, 'info');
      return;
    }

    if (previousSnapshot.phase !== nextSnapshot.phase) {
      if (nextSnapshot.phase === 'farkle') {
        this.showBanner('爆骰，本回合暂存已清空', 'warn');
        return;
      }

      if (nextSnapshot.phase === 'awaiting_selection') {
        this.showBanner('请选择要计分的骰子', 'info');
        return;
      }

      if (nextSnapshot.phase === 'can_bank_or_continue') {
        this.showBanner('已完成计分，可以继续掷骰或入账', 'info');
        return;
      }

      if (nextSnapshot.phase === 'ready_to_roll') {
        this.showBanner(`等待玩家 ${nextSnapshot.current_player} 掷骰`, 'info');
      }
    }
  }

  private async presentVictory(snapshot: GameSnapshot): Promise<void> {
    const victoryKey = this.buildVictoryKey(snapshot);

    if (this.presentedVictoryKey === victoryKey) {
      return;
    }

    this.presentedVictoryKey = victoryKey;
    this.presentationBusy = true;
    this.hideBanner();
    this.populateVictory(snapshot);
    this.showVictoryOverlay();
    this.launchConfetti();
    this.render();
    await this.scene.transitionToSetupView();
    this.presentationBusy = false;
    this.render();
  }

  private populateVictory(snapshot: GameSnapshot): void {
    const winnerLabel = snapshot.winner ? `玩家 ${snapshot.winner}` : '无人';
    this.elements.victoryTitle.textContent = snapshot.winner ? `玩家 ${snapshot.winner} 获胜` : '对局结束';
    this.elements.victoryWinner.textContent = winnerLabel;
    this.elements.victoryScoreA.textContent = `${snapshot.scores.A ?? 0}`;
    this.elements.victoryScoreB.textContent = `${snapshot.scores.B ?? 0}`;
    this.elements.victoryTarget.textContent = `${snapshot.target_score}`;
  }

  private showVictoryOverlay(): void {
    this.elements.victoryOverlay.classList.add('is-visible');
    this.elements.victoryOverlay.setAttribute('aria-hidden', 'false');
  }

  private hideVictoryOverlay(): void {
    this.elements.victoryOverlay.classList.remove('is-visible');
    this.elements.victoryOverlay.setAttribute('aria-hidden', 'true');
  }

  private buildVictoryKey(snapshot: GameSnapshot): string {
    return [
      snapshot.winner ?? 'none',
      snapshot.scores.A ?? 0,
      snapshot.scores.B ?? 0,
      snapshot.target_score,
    ].join(':');
  }

  private launchConfetti(): void {
    this.clearConfetti();
    const layer = this.elements.confettiLayer;

    for (let index = 0; index < 108; index += 1) {
      const piece = document.createElement('span');
      const size = randomRange(0.52, 1.18);
      piece.className = 'confetti-piece';
      piece.style.setProperty('--piece-width', `${size}rem`);
      piece.style.setProperty('--piece-height', `${size * randomRange(0.2, 0.42)}rem`);
      piece.style.setProperty('--piece-start-x', `${randomRange(4, 96)}vw`);
      piece.style.setProperty('--piece-drift-x', `${randomSignedRange(8, 26)}vw`);
      piece.style.setProperty('--piece-delay', `${randomRange(0, 220)}ms`);
      piece.style.setProperty('--piece-duration', `${randomRange(2600, 4000)}ms`);
      piece.style.setProperty('--piece-rotation', `${randomSignedRange(320, 1080)}deg`);
      piece.style.setProperty('--piece-color', CONFETTI_COLORS[index % CONFETTI_COLORS.length]);
      layer.appendChild(piece);
    }

    this.clearConfettiTimer();
    this.confettiCleanupId = window.setTimeout(() => {
      this.clearConfetti();
      this.confettiCleanupId = null;
    }, 4300);
  }

  private clearConfetti(): void {
    this.clearConfettiTimer();
    this.elements.confettiLayer.innerHTML = '';
  }

  private clearConfettiTimer(): void {
    if (this.confettiCleanupId === null) {
      return;
    }

    window.clearTimeout(this.confettiCleanupId);
    this.confettiCleanupId = null;
  }

  private showBanner(message: string, tone: 'info' | 'warn' | 'success', persist = false): void {
    const banner = this.elements.phaseBanner;

    this.clearBannerTimer();
    banner.textContent = message;
    banner.classList.remove('banner-info', 'banner-warn', 'banner-success', 'is-persist');
    banner.classList.add('is-visible', `banner-${tone}`);

    if (persist) {
      banner.classList.add('is-persist');
      return;
    }

    this.bannerTimeoutId = window.setTimeout(() => {
      banner.classList.remove('is-visible', 'banner-info', 'banner-warn', 'banner-success', 'is-persist');
      this.bannerTimeoutId = null;
    }, 2200);
  }

  private hideBanner(): void {
    const banner = this.elements.phaseBanner;
    this.clearBannerTimer();
    banner.classList.remove('is-visible', 'banner-info', 'banner-warn', 'banner-success', 'is-persist');
  }

  private async showCenterNotice(message: string, holdMs: number, fadeMs: number): Promise<void> {
    const notice = this.elements.centerNotice;
    notice.textContent = message;
    notice.classList.add('is-visible');
    await this.delay(holdMs);
    notice.classList.remove('is-visible');
    await this.delay(fadeMs);
    notice.textContent = '';
  }

  private clearBannerTimer(): void {
    if (this.bannerTimeoutId === null) {
      return;
    }

    window.clearTimeout(this.bannerTimeoutId);
    this.bannerTimeoutId = null;
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return '请求失败';
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomSignedRange(min: number, max: number): number {
  return randomRange(min, max) * (Math.random() > 0.5 ? 1 : -1);
}
