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
  seedInput: HTMLInputElement;
  newGameButton: HTMLButtonElement;
  rollButton: HTMLButtonElement;
  bankButton: HTMLButtonElement;
  connectionBadge: HTMLSpanElement;
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
}

interface ActionOptions {
  pendingMessage?: string;
  resetSelection?: boolean;
  onSuccess?: (response: GameActionResponse) => Promise<void>;
}

export class GameApp {
  private readonly elements: ElementMap;
  private readonly scene: TrayScene;
  private snapshot: GameSnapshot | null = null;
  private preview: PreviewPayload | null = null;
  private selectedIndices: number[] = [];
  private busy = false;
  private previewToken = 0;
  private bannerTimeoutId: number | null = null;

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
      this.applyResponse(response, true);
    } catch (error) {
      this.markConnection(false);
      this.showBanner(this.describeError(error), 'warn');
      this.render();
    }
  }

  dispose(): void {
    this.scene.setDieClickHandler(null);
    this.clearBannerTimer();
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
      seedInput: query<HTMLInputElement>('#seed-value'),
      newGameButton: query<HTMLButtonElement>('#new-game-button'),
      rollButton: query<HTMLButtonElement>('#roll-button'),
      bankButton: query<HTMLButtonElement>('#bank-button'),
      connectionBadge: query<HTMLSpanElement>('#connection-badge'),
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
    };
  }

  private bindEvents(): void {
    this.elements.newGameButton.addEventListener('click', () => {
      void this.handleNewGame();
    });
    this.elements.rollButton.addEventListener('click', () => {
      void this.handlePrimaryAction();
    });
    this.elements.bankButton.addEventListener('click', () => {
      void this.handleSaveAndEndTurn();
    });
  }

  private markConnection(connected: boolean): void {
    this.elements.connectionBadge.textContent = connected ? '后端已连接' : '后端未连接';
    this.elements.connectionBadge.classList.toggle('badge-online', connected);
    this.elements.connectionBadge.classList.toggle('badge-offline', !connected);
  }

  private async handleNewGame(): Promise<void> {
    const targetScore = Number.parseInt(this.elements.targetInput.value, 10);
    const seedText = this.elements.seedInput.value.trim();

    if (!Number.isInteger(targetScore) || targetScore <= 0) {
      this.showBanner('目标分数必须是正整数', 'warn');
      return;
    }

    if (seedText.length > 0 && !/^-?\d+$/.test(seedText)) {
      this.showBanner('随机种子必须是整数', 'warn');
      return;
    }

    const seed = seedText.length > 0 ? Number.parseInt(seedText, 10) : undefined;
    await this.runAction(() => newGame({ target_score: targetScore, seed }), {
      pendingMessage: '正在开始新对局...',
    });
  }

  private async handlePrimaryAction(): Promise<void> {
    const snapshot = this.snapshot;

    if (!snapshot || this.busy) {
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

    if (!snapshot || this.busy) {
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
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection' || this.busy) {
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
    if (this.busy) {
      return;
    }

    this.busy = true;
    let responseReceived = false;
    if (options.pendingMessage) {
      this.showBanner(options.pendingMessage, 'info');
    }
    this.render();

    try {
      const response = await action();
      responseReceived = true;
      this.markConnection(true);
      if (options.onSuccess) {
        await options.onSuccess(response);
      }
      this.applyResponse(response, options.resetSelection ?? true);
    } catch (error) {
      if (!responseReceived) {
        this.markConnection(false);
      }
      this.showBanner(this.describeError(error), 'warn');
      this.render();
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async runBusyTask(pendingMessage: string, task: () => Promise<void>): Promise<void> {
    if (this.busy) {
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

    this.syncScene();
    this.handleTransitions(previousSnapshot, this.snapshot, response.message);
    this.render();
  }

  private syncScene(): void {
    const diceValues = this.snapshot?.current_roll ?? [];
    this.scene.setDiceValues(diceValues);
    this.scene.setSelectedIndices(this.selectedIndices);
    this.scene.setInteractive(this.snapshot?.phase === 'awaiting_selection' && !this.busy);
  }

  private render(): void {
    const snapshot = this.snapshot;
    const currentPlayer = snapshot?.current_player ?? 'A';
    const roundScoreA = currentPlayer === 'A' ? snapshot?.turn_points ?? 0 : 0;
    const roundScoreB = currentPlayer === 'B' ? snapshot?.turn_points ?? 0 : 0;
    const selectedScoreA = currentPlayer === 'A' && this.preview?.is_valid ? this.preview.points : 0;
    const selectedScoreB = currentPlayer === 'B' && this.preview?.is_valid ? this.preview.points : 0;
    const canCommitSelection = snapshot?.phase === 'awaiting_selection' && this.hasValidPreview();
    const canPrimaryAct =
      !this.busy &&
      !!snapshot &&
      (snapshot.phase === 'ready_to_roll'
        ? snapshot.available_actions.roll
        : snapshot.phase === 'awaiting_selection'
          ? canCommitSelection
          : snapshot.phase === 'can_bank_or_continue'
            ? snapshot.available_actions.continue_turn
            : false);
    const canBankAct =
      !this.busy &&
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
    this.elements.newGameButton.disabled = this.busy;
    this.elements.rollButton.disabled = !canPrimaryAct;
    this.elements.bankButton.disabled = !canBankAct;
    this.scene.setInteractive(snapshot?.phase === 'awaiting_selection' && !this.busy);
  }

  private hasValidPreview(): boolean {
    return this.selectedIndices.length > 0 && this.preview?.is_valid === true;
  }

  private async resolveFarkleIfNeeded(response: GameActionResponse): Promise<GameActionResponse> {
    if (response.snapshot.phase !== 'farkle') {
      return response;
    }

    this.hideBanner();
    await this.showCenterNotice('\u672c\u8f6e\u4f5c\u5e9f\uff01', 1000, 520);
    const resolved = await resolveFarkleTurn();
    this.markConnection(true);
    return resolved;
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, durationMs);
    });
  }

  private handleTransitions(
    previousSnapshot: GameSnapshot | null,
    nextSnapshot: GameSnapshot,
    responseMessage: string,
  ): void {
    if (nextSnapshot.phase === 'game_over') {
      this.showBanner(nextSnapshot.winner ? `${nextSnapshot.winner} 获胜` : '对局结束', 'success', true);
      return;
    }

    if (responseMessage === 'Started a new game.') {
      this.showBanner('新对局已开始', 'info');
      return;
    }

    if (!previousSnapshot) {
      this.showBanner('已加载当前对局', 'info');
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
