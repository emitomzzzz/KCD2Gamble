import {
  DEFAULT_ROOM_ID,
  bankCurrentTurn,
  buildRoomSocketUrl,
  continuePlaying,
  getRoomState,
  getSessionInfo,
  joinRoom,
  leaveRoom,
  newGame,
  previewSelection,
  resolveFarkleTurn,
  rollDice,
  setSessionInfo,
  takeSelection,
} from '../api/gameApi';
import {
  getHotseatSessionInfo,
  getHotseatState,
  hotseatBankCurrentTurn,
  hotseatContinuePlaying,
  hotseatPreviewSelection,
  hotseatResolveFarkleTurn,
  hotseatRollDice,
  hotseatTakeSelection,
  releaseHotseatGame,
  setHotseatSessionInfo,
  startHotseatGame,
} from '../api/hotseatApi';
import { TrayScene } from '../scene/TrayScene';
import type {
  GameActionResponse,
  GameMode,
  GameSnapshot,
  HotseatSessionInfo,
  JoinRoomResponse,
  PreviewPayload,
  RoomEvent,
  RoomState,
  SeatId,
  SessionInfo,
} from '../types/game';

interface ElementMap {
  targetInput: HTMLInputElement;
  setupOverlay: HTMLElement;
  setupForm: HTMLElement;
  setupHelp: HTMLElement;
  seatPicker: HTMLElement;
  modeLanButton: HTMLButtonElement;
  modeHotseatButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  victoryNewGameButton: HTMLButtonElement;
  seatAButton: HTMLButtonElement;
  seatBButton: HTMLButtonElement;
  seatStatus: HTMLElement;
  statusPanel: HTMLElement;
  actionPanel: HTMLElement;
  rollButton: HTMLButtonElement;
  bankButton: HTMLButtonElement;
  localSeatChip: HTMLElement;
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
const LAN_SESSION_STORAGE_KEY = 'kcd2gamble.lan.session';
const HOTSEAT_SESSION_STORAGE_KEY = 'kcd2gamble.hotseat.session';
const MODE_STORAGE_KEY = 'kcd2gamble.mode';
const SOCKET_RECONNECT_DELAY_MS = 1500;

export class GameApp {
  private readonly elements: ElementMap;
  private readonly scene: TrayScene;
  private snapshot: GameSnapshot | null = null;
  private roomState: RoomState | null = null;
  private preview: PreviewPayload | null = null;
  private lanSession: SessionInfo | null = null;
  private hotseatSession: HotseatSessionInfo | null = null;
  private mode: GameMode = 'lan';
  private selectedSeat: SeatId = 'A';
  private selectedIndices: number[] = [];
  private roomSocket: WebSocket | null = null;
  private backendConnected = false;
  private busy = false;
  private presentationBusy = false;
  private hudVisible = false;
  private setupVisible = true;
  private disposed = false;
  private previewToken = 0;
  private bannerTimeoutId: number | null = null;
  private confettiCleanupId: number | null = null;
  private socketReconnectId: number | null = null;
  private presentedVictoryKey: string | null = null;
  private lastSentCursorSignature: string | null = null;

  constructor(root: HTMLElement, scene: TrayScene) {
    this.scene = scene;
    this.elements = this.collectElements(root);
    this.lanSession = getSessionInfo();
    this.hotseatSession = getHotseatSessionInfo();
    this.mode = this.loadStoredMode();
    this.selectedSeat = this.lanSession?.seat ?? 'A';
    this.bindEvents();
    this.scene.setDieClickHandler((index) => {
      void this.toggleDie(index);
    });
    this.scene.setFocusChangeHandler(this.handleSceneFocusChanged);
  }

  async init(): Promise<void> {
    const restored = await this.restoreStoredSession();

    if (!restored && this.mode === 'lan') {
      await this.refreshLanRoomState(false);
    }

    this.scene.setDiceValues(this.snapshot?.current_roll ?? []);
    this.scene.clearTakenDice();
    this.syncScene();
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.handleKeyDown);
    this.releaseSeatOnUnload();
    this.closeRoomSocket();
    this.clearSocketReconnectTimer();
    this.scene.setDieClickHandler(null);
    this.scene.setFocusChangeHandler(null);
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
      setupHelp: query<HTMLElement>('#setup-help'),
      seatPicker: query<HTMLElement>('#seat-picker'),
      modeLanButton: query<HTMLButtonElement>('#mode-lan-button'),
      modeHotseatButton: query<HTMLButtonElement>('#mode-hotseat-button'),
      newGameButton: query<HTMLButtonElement>('#new-game-button'),
      victoryNewGameButton: query<HTMLButtonElement>('#victory-new-game-button'),
      seatAButton: query<HTMLButtonElement>('#seat-a-button'),
      seatBButton: query<HTMLButtonElement>('#seat-b-button'),
      seatStatus: query<HTMLElement>('#seat-status'),
      statusPanel: query<HTMLElement>('#status-panel'),
      actionPanel: query<HTMLElement>('#action-panel'),
      rollButton: query<HTMLButtonElement>('#roll-button'),
      bankButton: query<HTMLButtonElement>('#bank-button'),
      localSeatChip: query<HTMLElement>('#local-seat-chip'),
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
    window.addEventListener('keydown', this.handleKeyDown);
    this.elements.modeLanButton.addEventListener('click', () => {
      void this.handleModeSelection('lan');
    });
    this.elements.modeHotseatButton.addEventListener('click', () => {
      void this.handleModeSelection('hotseat');
    });
    this.elements.seatAButton.addEventListener('click', () => {
      this.handleSeatSelection('A');
    });
    this.elements.seatBButton.addEventListener('click', () => {
      this.handleSeatSelection('B');
    });
    this.elements.newGameButton.addEventListener('click', () => {
      void this.handleSetupSubmit();
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

  private readonly handleSceneFocusChanged = (focusedIndex: number | null): void => {
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection' || !this.isLocalTurn(this.snapshot)) {
      return;
    }

    this.updateLocalCursorState(focusedIndex);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (this.uiBusy || this.setupVisible || !this.hudVisible || !this.snapshot || !this.isLocalTurn(this.snapshot)) {
      return;
    }

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement ||
      activeElement?.hasAttribute('contenteditable') ||
      (activeElement instanceof HTMLInputElement && activeElement.type !== 'button')
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 'f') {
      event.preventDefault();
      void this.handlePrimaryAction();
      return;
    }

    if (key === 'q') {
      event.preventDefault();
      void this.handleSaveAndEndTurn();
      return;
    }

    if (this.snapshot.phase !== 'awaiting_selection') {
      return;
    }

    if (key === 'e') {
      const focusedIndex = this.scene.getFocusedIndex();
      if (focusedIndex !== null) {
        event.preventDefault();
        void this.toggleDie(focusedIndex);
      }
      return;
    }

    const direction =
      key === 'w' ? 'up' : key === 'a' ? 'left' : key === 's' ? 'down' : key === 'd' ? 'right' : null;

    if (direction && this.scene.moveFocus(direction)) {
      event.preventDefault();
    }
  };

  private get uiBusy(): boolean {
    return this.busy || this.presentationBusy;
  }

  private get localSeat(): SeatId | null {
    return this.mode === 'lan' ? this.lanSession?.seat ?? null : null;
  }

  private markConnection(connected: boolean): void {
    this.backendConnected = connected;
    this.elements.connectionBadge.classList.toggle('badge-online', connected);
    this.elements.connectionBadge.classList.toggle('badge-offline', !connected);
  }

  private async handleModeSelection(mode: GameMode): Promise<void> {
    if (this.mode === mode || this.uiBusy) {
      return;
    }

    if (this.setupVisible) {
      if (this.mode === 'lan' && this.lanSession) {
        await this.leaveCurrentSeat(false);
      }
      if (this.mode === 'hotseat' && this.hotseatSession) {
        await this.releaseCurrentHotseat(false);
      }
    }

    this.mode = mode;
    this.saveStoredMode(mode);

    if (mode === 'lan') {
      await this.refreshLanRoomState(false);
    }

    this.render();
  }

  private handleSeatSelection(seat: SeatId): void {
    this.selectedSeat = seat;
    this.render();
  }

  private openSetupOverlay(): void {
    this.setupVisible = true;
    if (this.mode === 'lan') {
      void this.refreshLanRoomState(false);
    }
    this.render();
  }

  private closeSetupOverlay(): void {
    this.setupVisible = false;
    this.blurActiveElement();
    this.render();
  }

  private async handleSetupSubmit(): Promise<void> {
    if (this.uiBusy) {
      return;
    }

    const targetScore = Number.parseInt(this.elements.targetInput.value, 10);
    if (!Number.isInteger(targetScore) || targetScore <= 0) {
      this.showBanner('目标分数必须是正整数。', 'warn');
      return;
    }

    if (this.mode === 'hotseat') {
      await this.startHotseatFlow(targetScore);
      return;
    }

    await this.startLanFlow(targetScore);
  }

  private async startLanFlow(targetScore: number): Promise<void> {
    if (this.hotseatSession) {
      await this.releaseCurrentHotseat(false);
    }

    if (this.lanSession && this.lanSession.seat !== this.selectedSeat) {
      await this.leaveCurrentSeat(false);
    }

    if (!this.lanSession) {
      try {
        await this.joinSeat(this.selectedSeat, null, true);
      } catch (error) {
        this.markConnection(false);
        this.showBanner(this.describeError(error), 'warn');
        this.render();
        return;
      }
    }

    if (this.lanSession?.seat === 'A') {
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
      return;
    }

    this.hideVictoryOverlay();
    this.clearConfetti();
    this.hudVisible = true;
    this.closeSetupOverlay();
    await this.scene.transitionToPlayView();
    this.showBanner('已进入当前对局，等待玩家 A 开始或轮到你。', 'info');
    this.render();
  }

  private async startHotseatFlow(targetScore: number): Promise<void> {
    if (this.lanSession) {
      await this.leaveCurrentSeat(false);
    }

    await this.runBusyTask('正在开始同屏对局...', async () => {
      const response = await startHotseatGame({ target_score: targetScore });
      this.markConnection(true);
      this.mode = 'hotseat';
      this.saveStoredMode('hotseat');
      this.hotseatSession = response.session;
      this.saveStoredHotseatSession(response.session);
      this.snapshot = response.snapshot;
      this.roomState = response.room;
      this.preview = null;
      this.selectedIndices = [];
      this.previewToken += 1;
      this.lastSentCursorSignature = null;
      this.presentedVictoryKey = null;
      this.hideVictoryOverlay();
      this.clearConfetti();
      this.scene.clearTakenDice();
      this.hudVisible = true;
      this.closeSetupOverlay();
      await this.scene.transitionToPlayView();
      this.syncScene();
      this.showBanner('同屏对局已开始。', 'success');
      this.render();
    });
  }

  private async restoreStoredSession(): Promise<boolean> {
    const storedLan = this.loadStoredLanSession();
    const storedHotseat = this.loadStoredHotseatSession();
    const restoreOrder: GameMode[] = this.mode === 'hotseat' ? ['hotseat', 'lan'] : ['lan', 'hotseat'];

    for (const candidate of restoreOrder) {
      try {
        if (candidate === 'lan' && storedLan) {
          await this.joinSeat(storedLan.seat, storedLan.seat_token, false);
          this.mode = 'lan';
          this.hudVisible = true;
          this.setupVisible = false;
          await this.scene.transitionToPlayView();
          return true;
        }

        if (candidate === 'hotseat' && storedHotseat) {
          setHotseatSessionInfo(storedHotseat);
          this.hotseatSession = storedHotseat;
          const response = await getHotseatState();
          this.markConnection(true);
          this.mode = 'hotseat';
          this.snapshot = response.snapshot;
          this.roomState = response.room;
          this.hudVisible = true;
          this.setupVisible = false;
          await this.scene.transitionToPlayView();
          return true;
        }
      } catch {
        if (candidate === 'lan') {
          this.clearLanSessionState();
        } else {
          this.clearHotseatSessionState();
        }
      }
    }

    return false;
  }

  private async joinSeat(seat: SeatId, seatToken: string | null, announce = true): Promise<JoinRoomResponse> {
    const response = await joinRoom({ room_id: DEFAULT_ROOM_ID, seat, seat_token: seatToken });
    this.markConnection(true);
    this.mode = 'lan';
    this.saveStoredMode('lan');
    this.lanSession = response.session;
    this.selectedSeat = response.session.seat;
    this.snapshot = response.snapshot;
    this.roomState = response.room;
    this.saveStoredLanSession(response.session);
    this.openRoomSocket();

    if (announce) {
      this.showBanner(`已加入玩家 ${response.session.seat}。`, 'success');
    }

    return response;
  }

  private async leaveCurrentSeat(showBanner = false): Promise<void> {
    if (!this.lanSession) {
      return;
    }

    try {
      const response = await leaveRoom();
      if (response) {
        this.snapshot = response.snapshot;
        this.roomState = response.room;
      }
      if (showBanner) {
        this.showBanner('已离开当前座位。', 'info');
      }
    } catch {
      // Ignore leave errors during mode switching.
    }

    this.clearLanSessionState();
    if (this.mode === 'lan') {
      await this.refreshLanRoomState(false);
    }
  }

  private async releaseCurrentHotseat(showBanner = false): Promise<void> {
    if (!this.hotseatSession) {
      return;
    }

    try {
      await releaseHotseatGame();
      if (showBanner) {
        this.showBanner('已结束同屏对局会话。', 'info');
      }
    } catch {
      // Ignore release errors during mode switching.
    }

    this.clearHotseatSessionState();
  }

  private openRoomSocket(): void {
    if (!this.lanSession) {
      return;
    }

    const url = buildRoomSocketUrl(this.lanSession);
    if (this.roomSocket && (this.roomSocket.readyState === WebSocket.OPEN || this.roomSocket.readyState === WebSocket.CONNECTING)) {
      if (this.roomSocket.url === url) {
        return;
      }
      this.closeRoomSocket();
    }

    this.clearSocketReconnectTimer();
    const socket = new WebSocket(url);
    this.roomSocket = socket;

    socket.addEventListener('open', () => {
      if (this.roomSocket !== socket) {
        return;
      }
      this.markConnection(true);
      this.render();
    });

    socket.addEventListener('message', (event) => {
      if (this.roomSocket !== socket) {
        return;
      }
      this.handleRoomSocketMessage(event.data);
    });

    socket.addEventListener('close', (event) => {
      if (this.roomSocket !== socket) {
        return;
      }
      this.roomSocket = null;

      if (this.disposed) {
        return;
      }

      if (event.code === 4403) {
        this.clearLanSessionState();
        this.hudVisible = false;
        this.openSetupOverlay();
        this.showBanner('座位凭证已失效，请重新加入。', 'warn');
        return;
      }

      this.markConnection(false);
      if (this.lanSession) {
        this.scheduleSocketReconnect();
      }
    });

    socket.addEventListener('error', () => {
      if (this.roomSocket === socket) {
        this.markConnection(false);
      }
    });
  }

  private closeRoomSocket(): void {
    if (!this.roomSocket) {
      return;
    }

    const socket = this.roomSocket;
    this.roomSocket = null;
    socket.close();
  }

  private scheduleSocketReconnect(): void {
    if (this.socketReconnectId !== null || !this.lanSession) {
      return;
    }

    this.socketReconnectId = window.setTimeout(() => {
      this.socketReconnectId = null;
      if (!this.disposed && this.lanSession) {
        this.openRoomSocket();
      }
    }, SOCKET_RECONNECT_DELAY_MS);
  }

  private clearSocketReconnectTimer(): void {
    if (this.socketReconnectId === null) {
      return;
    }

    window.clearTimeout(this.socketReconnectId);
    this.socketReconnectId = null;
  }

  private handleRoomSocketMessage(payload: string): void {
    try {
      const event = JSON.parse(payload) as RoomEvent;
      this.roomState = event.room;
      this.markConnection(true);

      if (event.type === 'cursor_state') {
        this.snapshot = event.snapshot;
        this.syncScene();
        this.render();
        return;
      }

      if (this.lanSession && event.actor_seat === this.lanSession.seat && this.busy) {
        this.render();
        return;
      }

      const response: GameActionResponse = {
        message: event.message,
        snapshot: event.snapshot,
        room: event.room,
      };
      this.applyResponse(response, true);
    } catch (error) {
      console.error('Failed to handle room event', error);
    }
  }

  private async refreshLanRoomState(showError = true): Promise<void> {
    try {
      const response = await getRoomState(DEFAULT_ROOM_ID);
      this.markConnection(true);
      this.snapshot = response.snapshot;
      this.roomState = response.room;
      if (!this.lanSession) {
        this.elements.targetInput.value = `${response.snapshot.target_score ?? 5000}`;
      }
    } catch (error) {
      this.markConnection(false);
      if (showError) {
        this.showBanner(this.describeError(error), 'warn');
      }
    }
  }

  private loadStoredLanSession(): SessionInfo | null {
    try {
      const raw = window.localStorage.getItem(LAN_SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as SessionInfo;
      if (!parsed.room_id || !parsed.seat || !parsed.seat_token) {
        return null;
      }
      setSessionInfo(parsed);
      this.lanSession = parsed;
      this.selectedSeat = parsed.seat;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveStoredLanSession(session: SessionInfo): void {
    window.localStorage.setItem(LAN_SESSION_STORAGE_KEY, JSON.stringify(session));
    setSessionInfo(session);
    this.lanSession = session;
  }

  private clearLanSessionState(): void {
    this.closeRoomSocket();
    this.clearSocketReconnectTimer();
    this.lanSession = null;
    this.lastSentCursorSignature = null;
    setSessionInfo(null);
    window.localStorage.removeItem(LAN_SESSION_STORAGE_KEY);
  }

  private loadStoredHotseatSession(): HotseatSessionInfo | null {
    try {
      const raw = window.sessionStorage.getItem(HOTSEAT_SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as HotseatSessionInfo;
      if (!parsed.session_token) {
        return null;
      }
      setHotseatSessionInfo(parsed);
      this.hotseatSession = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveStoredHotseatSession(session: HotseatSessionInfo): void {
    window.sessionStorage.setItem(HOTSEAT_SESSION_STORAGE_KEY, JSON.stringify(session));
    setHotseatSessionInfo(session);
    this.hotseatSession = session;
  }

  private clearHotseatSessionState(): void {
    this.hotseatSession = null;
    setHotseatSessionInfo(null);
    window.sessionStorage.removeItem(HOTSEAT_SESSION_STORAGE_KEY);
  }

  private blurActiveElement(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  private loadStoredMode(): GameMode {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    return stored === 'hotseat' ? 'hotseat' : 'lan';
  }

  private saveStoredMode(mode: GameMode): void {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }

  private releaseSeatOnUnload(): void {
    if (!this.lanSession) {
      return;
    }

    const payload = JSON.stringify({
      room_id: this.lanSession.room_id,
      seat: this.lanSession.seat,
      seat_token: this.lanSession.seat_token,
    });
    const url = `${window.location.origin}/api/room/leave`;
    const body = new Blob([payload], { type: 'application/json' });

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, body);
      } else {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      // Ignore unload errors.
    }

    this.clearLanSessionState();
  }

  private isLocalTurn(snapshot: GameSnapshot): boolean {
    return this.mode === 'hotseat' || this.lanSession?.seat === snapshot.current_player;
  }

  private getDisplayedCursorState(): { focusedIndex: number | null; selectedIndices: number[] } {
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection') {
      return { focusedIndex: null, selectedIndices: [] };
    }

    if (this.isLocalTurn(this.snapshot)) {
      return {
        focusedIndex: this.scene.getFocusedIndex(),
        selectedIndices: [...this.selectedIndices],
      };
    }

    const remoteCursor = this.roomState?.cursors[this.snapshot.current_player];
    return {
      focusedIndex: remoteCursor?.focused_index ?? null,
      selectedIndices: [...(remoteCursor?.selected_indices ?? [])],
    };
  }

  private updateLocalCursorState(focusedIndex: number | null = this.scene.getFocusedIndex()): void {
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection' || !this.isLocalTurn(this.snapshot)) {
      return;
    }

    if (this.mode === 'lan' && this.roomState && this.lanSession) {
      this.roomState = {
        ...this.roomState,
        cursors: {
          ...this.roomState.cursors,
          [this.lanSession.seat]: {
            focused_index: focusedIndex,
            selected_indices: [...this.selectedIndices],
          },
        },
      };
      this.sendCursorUpdate(focusedIndex, this.selectedIndices);
    }

    this.render();
  }

  private sendCursorUpdate(focusedIndex: number | null, selectedIndices: number[]): void {
    if (
      this.mode !== 'lan' ||
      !this.snapshot ||
      !this.lanSession ||
      !this.roomSocket ||
      this.roomSocket.readyState !== WebSocket.OPEN ||
      this.setupVisible ||
      this.snapshot.phase !== 'awaiting_selection' ||
      !this.isLocalTurn(this.snapshot)
    ) {
      return;
    }

    const payload = {
      type: 'cursor_state' as const,
      focused_index: focusedIndex,
      selected_indices: [...selectedIndices],
    };
    const signature = JSON.stringify(payload);

    if (signature === this.lastSentCursorSignature) {
      return;
    }

    this.lastSentCursorSignature = signature;
    this.roomSocket.send(signature);
  }

  private async requestPreview(indices: number[]): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatPreviewSelection(indices) : previewSelection(indices);
  }

  private async requestTakeSelection(indices: number[]): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatTakeSelection(indices) : takeSelection(indices);
  }

  private async requestContinueTurn(): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatContinuePlaying() : continuePlaying();
  }

  private async requestBankTurn(): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatBankCurrentTurn() : bankCurrentTurn();
  }

  private async requestRoll(): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatRollDice() : rollDice();
  }

  private async requestResolveFarkle(): Promise<GameActionResponse> {
    return this.mode === 'hotseat' ? hotseatResolveFarkleTurn() : resolveFarkleTurn();
  }

  private async handlePrimaryAction(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.uiBusy || this.setupVisible || !this.isLocalTurn(snapshot)) {
      return;
    }

    if (snapshot.phase === 'ready_to_roll') {
      await this.runBusyTask('正在掷骰...', async () => {
        const startingDice = snapshot.remaining_dice || 6;
        const response = await this.requestRoll();
        this.markConnection(true);
        await this.scene.playRollAnimation(response.snapshot.current_roll, startingDice);
        const finalResponse = await this.resolveFarkleIfNeeded(response);
        this.applyResponse(finalResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'awaiting_selection') {
      if (!this.hasValidPreview()) {
        this.showBanner('请先选择有效的计分骰子。', 'warn');
        this.render();
        return;
      }

      await this.runBusyTask('正在拿走已计分骰子并继续掷骰...', async () => {
        const selected = [...this.selectedIndices];
        const takeResponse = await this.requestTakeSelection(selected);
        this.markConnection(true);
        await this.scene.playTakeSelectionAnimation(selected, takeResponse.take_result?.hot_dice ?? false);
        const continueResponse = await this.requestContinueTurn();
        this.markConnection(true);
        await this.scene.playRollAnimation(continueResponse.snapshot.current_roll, takeResponse.snapshot.remaining_dice);
        const finalResponse = await this.resolveFarkleIfNeeded(continueResponse);
        this.applyResponse(finalResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'can_bank_or_continue') {
      await this.runBusyTask('正在继续掷剩余骰子...', async () => {
        const response = await this.requestContinueTurn();
        this.markConnection(true);
        await this.scene.playRollAnimation(response.snapshot.current_roll, snapshot.remaining_dice);
        const finalResponse = await this.resolveFarkleIfNeeded(response);
        this.applyResponse(finalResponse, true);
      });
    }
  }

  private async handleSaveAndEndTurn(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.uiBusy || this.setupVisible || !this.isLocalTurn(snapshot)) {
      return;
    }

    if (snapshot.phase === 'awaiting_selection') {
      if (!this.hasValidPreview()) {
        this.showBanner('请先选择有效的计分骰子。', 'warn');
        this.render();
        return;
      }

      await this.runBusyTask('正在保存本回合分数...', async () => {
        const selected = [...this.selectedIndices];
        const takeResponse = await this.requestTakeSelection(selected);
        this.markConnection(true);
        await this.scene.playTakeSelectionAnimation(selected, takeResponse.take_result?.hot_dice ?? false);
        const bankResponse = await this.requestBankTurn();
        this.markConnection(true);
        this.applyResponse(bankResponse, true);
      });
      return;
    }

    if (snapshot.phase === 'can_bank_or_continue') {
      await this.runAction(() => this.requestBankTurn(), {
        pendingMessage: '正在保存本回合分数...',
      });
    }
  }

  private async toggleDie(index: number): Promise<void> {
    if (!this.snapshot || this.snapshot.phase !== 'awaiting_selection' || this.uiBusy || this.setupVisible || !this.isLocalTurn(this.snapshot)) {
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
    this.updateLocalCursorState();

    if (this.selectedIndices.length === 0) {
      this.render();
      return;
    }

    const token = ++this.previewToken;

    try {
      const response = await this.requestPreview(this.selectedIndices);
      if (token !== this.previewToken) {
        return;
      }
      this.markConnection(true);
      this.snapshot = response.snapshot;
      this.roomState = response.room;
      this.preview = response.preview ?? null;
      this.updateLocalCursorState();
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
      this.syncScene();
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
      this.syncScene();
      this.render();
    }
  }

  private applyResponse(response: GameActionResponse, resetSelection: boolean): void {
    const previousSnapshot = this.snapshot;
    this.snapshot = response.snapshot;
    this.roomState = response.room;

    if (resetSelection || this.snapshot.phase !== 'awaiting_selection') {
      this.selectedIndices = [];
      this.preview = null;
      this.previewToken += 1;
      this.lastSentCursorSignature = null;
    } else {
      this.preview = response.preview ?? this.preview;
    }

    if (
      response.message === 'Started a new game.' ||
      response.message === 'Started a hotseat game.' ||
      this.snapshot.phase === 'game_over' ||
      (previousSnapshot !== null && previousSnapshot.current_player !== this.snapshot.current_player)
    ) {
      this.scene.clearTakenDice();
    }

    if (this.snapshot.phase !== 'game_over') {
      this.presentedVictoryKey = null;
    }

    this.syncScene();
    void this.handleTransitions(previousSnapshot, this.snapshot, response.message);
    this.render();
  }

  private syncScene(): void {
    const diceValues = this.snapshot?.current_roll ?? [];
    const isInteractive =
      this.hudVisible &&
      !this.setupVisible &&
      this.snapshot?.phase === 'awaiting_selection' &&
      !this.uiBusy &&
      !!this.snapshot &&
      this.isLocalTurn(this.snapshot);

    this.scene.setDiceValues(diceValues);
    this.scene.setInteractive(isInteractive);
    const displayedCursor = this.getDisplayedCursorState();
    this.scene.setSelectedIndices(displayedCursor.selectedIndices);
    this.scene.setFocusedIndex(displayedCursor.focusedIndex);
  }

  private render(): void {
    const snapshot = this.snapshot;
    const roomState = this.roomState;
    const currentPlayer = snapshot?.current_player ?? 'A';
    const uiBusy = this.uiBusy;
    const roundScoreA = currentPlayer === 'A' ? snapshot?.turn_points ?? 0 : 0;
    const roundScoreB = currentPlayer === 'B' ? snapshot?.turn_points ?? 0 : 0;
    const selectedScoreA = currentPlayer === 'A' && this.preview?.is_valid ? this.preview.points : 0;
    const selectedScoreB = currentPlayer === 'B' && this.preview?.is_valid ? this.preview.points : 0;
    const localSeat = this.localSeat;
    const canControlCurrentTurn =
      !uiBusy &&
      this.hudVisible &&
      !this.setupVisible &&
      !!snapshot &&
      this.isLocalTurn(snapshot) &&
      (this.mode === 'hotseat' || !!localSeat);
    const canCommitSelection = snapshot?.phase === 'awaiting_selection' && this.hasValidPreview();
    const canPrimaryAct =
      canControlCurrentTurn &&
      (snapshot?.phase === 'ready_to_roll'
        ? snapshot.available_actions.roll
        : snapshot?.phase === 'awaiting_selection'
          ? canCommitSelection
          : snapshot?.phase === 'can_bank_or_continue'
            ? snapshot.available_actions.continue_turn
            : false);
    const canBankAct =
      canControlCurrentTurn &&
      (snapshot?.phase === 'awaiting_selection'
        ? canCommitSelection
        : snapshot?.phase === 'can_bank_or_continue'
          ? snapshot.available_actions.bank_turn
          : false);
    const seatAState = roomState?.seats.A;
    const seatBState = roomState?.seats.B;
    const seatAOwnedByOther = this.mode === 'lan' && !!seatAState?.occupied && localSeat !== 'A';
    const seatBOwnedByOther = this.mode === 'lan' && !!seatBState?.occupied && localSeat !== 'B';
    const setupButtonLabel =
      this.mode === 'hotseat'
        ? '开始同屏对局'
        : !this.lanSession
          ? `加入玩家 ${this.selectedSeat}`
          : this.lanSession.seat === 'A'
            ? '开始新对局'
            : '进入当前对局';

    this.elements.setupHelp.textContent =
      this.mode === 'hotseat'
        ? '同一个页面里由双方轮流操作，回合和胜负仍按玩家 A / B 计算。'
        : '请选择玩家座位。玩家 A 可以开始新对局，玩家 B 可以加入同一局。';
    this.elements.seatPicker.classList.toggle('is-hidden', this.mode !== 'lan');
    this.elements.seatStatus.classList.toggle('is-hidden', this.mode !== 'lan');
    this.elements.modeLanButton.classList.toggle('is-selected', this.mode === 'lan');
    this.elements.modeHotseatButton.classList.toggle('is-selected', this.mode === 'hotseat');

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
    this.elements.rollButton.disabled = !canPrimaryAct;
    this.elements.bankButton.disabled = !canBankAct;
    this.elements.newGameButton.textContent = setupButtonLabel;
    this.elements.newGameButton.disabled =
      this.mode === 'hotseat' ? uiBusy : uiBusy || (this.selectedSeat === 'A' ? seatAOwnedByOther : seatBOwnedByOther);
    this.elements.victoryNewGameButton.disabled = uiBusy;

    this.elements.seatAButton.textContent = this.buildSeatButtonLabel('A', seatAState);
    this.elements.seatBButton.textContent = this.buildSeatButtonLabel('B', seatBState);
    this.elements.seatAButton.classList.toggle('is-selected', this.selectedSeat === 'A');
    this.elements.seatBButton.classList.toggle('is-selected', this.selectedSeat === 'B');
    this.elements.seatAButton.classList.toggle('is-owned', localSeat === 'A');
    this.elements.seatBButton.classList.toggle('is-owned', localSeat === 'B');
    this.elements.seatAButton.classList.toggle('is-unavailable', !!seatAOwnedByOther);
    this.elements.seatBButton.classList.toggle('is-unavailable', !!seatBOwnedByOther);
    this.elements.seatAButton.disabled = this.mode !== 'lan' || uiBusy || !!seatAOwnedByOther;
    this.elements.seatBButton.disabled = this.mode !== 'lan' || uiBusy || !!seatBOwnedByOther;
    this.elements.seatStatus.textContent = this.mode === 'lan' ? this.buildSeatStatusText(roomState) : '';

    this.elements.localSeatChip.textContent =
      this.mode === 'hotseat' ? '同屏轮流' : localSeat ? `你是玩家 ${localSeat}` : '未入座';
    this.elements.localSeatChip.classList.toggle('is-active', this.mode === 'hotseat' || !!localSeat);

    if (!this.backendConnected) {
      this.elements.connectionBadge.textContent = '后端未连接';
    } else if (this.mode === 'hotseat') {
      this.elements.connectionBadge.textContent = this.hotseatSession ? '后端已连接 · 同屏模式' : '后端已连接';
    } else {
      this.elements.connectionBadge.textContent = localSeat ? `后端已连接 · 玩家 ${localSeat}` : '后端已连接';
    }

    this.elements.statusPanel.classList.toggle('is-hidden', !this.hudVisible);
    this.elements.actionPanel.classList.toggle('is-hidden', !this.hudVisible);
    this.elements.setupOverlay.classList.toggle('is-visible', this.setupVisible);
    this.elements.setupOverlay.setAttribute('aria-hidden', String(!this.setupVisible));
    this.elements.setupForm.classList.toggle('is-visible', this.setupVisible);
    this.elements.setupForm.setAttribute('aria-hidden', String(!this.setupVisible));
  }

  private buildSeatButtonLabel(seat: SeatId, state: RoomState['seats'][SeatId] | undefined): string {
    const suffix = !state ? '空闲' : state.connected ? '已连接' : state.occupied ? '已占用' : '空闲';
    return `玩家 ${seat} · ${suffix}`;
  }

  private buildSeatStatusText(roomState: RoomState | null): string {
    if (!roomState) {
      return '正在读取房间状态...';
    }

    const formatSeat = (seat: SeatId): string => {
      const state = roomState.seats[seat];
      if (!state.occupied) {
        return `玩家 ${seat}：空闲`;
      }
      return `玩家 ${seat}：${state.connected ? '已连接' : '已占用'}`;
    };

    return `${formatSeat('A')}　|　${formatSeat('B')}`;
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
    const resolved = await this.requestResolveFarkle();
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

    if (responseMessage === 'Started a new game.' || responseMessage === 'Started a hotseat game.') {
      this.showBanner('新对局已开始。', 'info');
      return;
    }

    if (!previousSnapshot) {
      return;
    }

    if (previousSnapshot.current_player !== nextSnapshot.current_player) {
      this.showBanner(`轮到玩家 ${nextSnapshot.current_player}。`, 'info');
      return;
    }

    if (previousSnapshot.phase !== nextSnapshot.phase) {
      if (nextSnapshot.phase === 'farkle') {
        this.showBanner('爆骰，本回合暂存已清空。', 'warn');
      } else if (nextSnapshot.phase === 'awaiting_selection') {
        this.showBanner('请选择要计分的骰子。', 'info');
      } else if (nextSnapshot.phase === 'can_bank_or_continue') {
        this.showBanner('已完成计分，可以继续掷骰或入账。', 'info');
      } else if (nextSnapshot.phase === 'ready_to_roll') {
        this.showBanner(`等待玩家 ${nextSnapshot.current_player} 掷骰。`, 'info');
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
    const winnerLabel = snapshot.winner ? `玩家 ${snapshot.winner}` : '无人获胜';
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
    return [snapshot.winner ?? 'none', snapshot.scores.A ?? 0, snapshot.scores.B ?? 0, snapshot.target_score].join(':');
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
    return error instanceof Error ? error.message : '请求失败。';
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomSignedRange(min: number, max: number): number {
  return randomRange(min, max) * (Math.random() > 0.5 ? 1 : -1);
}
