import './style.css';
import { GameApp } from './app/GameApp';
import { TrayScene } from './scene/TrayScene';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root element');
}

root.innerHTML = `
  <div class="layout">
    <div id="phase-banner" class="phase-banner" aria-live="polite"></div>
    <div id="center-notice" class="center-notice" aria-live="assertive"></div>

    <div id="setup-overlay" class="setup-overlay is-visible" aria-hidden="false">
      <div class="setup-card">
        <div class="setup-hero">
          <div class="setup-eyebrow">KCD2Gamble 3D</div>
          <h1 class="setup-title">掷骰台</h1>
        </div>
        <div id="setup-form" class="setup-form is-visible" aria-hidden="false">
          <label class="field">
            <span>目标分数</span>
            <input id="target-score" type="number" min="0" step="500" value="5000" />
          </label>
          <div class="setup-actions">
            <button id="new-game-button" class="primary-button" type="button">开始游戏</button>
          </div>
          <span id="connection-badge" class="badge badge-offline">后端未连接</span>
        </div>
      </div>
    </div>

    <div id="victory-overlay" class="victory-overlay" aria-hidden="true">
      <div id="confetti-layer" class="confetti-layer"></div>
      <div class="victory-panel" role="dialog" aria-modal="false" aria-labelledby="victory-title">
        <div class="victory-eyebrow">对局结束</div>
        <h2 id="victory-title" class="victory-title">胜利结算</h2>
        <div class="victory-grid">
          <div class="victory-label">获胜玩家</div>
          <div id="victory-winner" class="victory-value victory-value-accent">玩家 A</div>
          <div class="victory-label">玩家 A 最终得分</div>
          <div id="victory-score-a" class="victory-value">0</div>
          <div class="victory-label">玩家 B 最终得分</div>
          <div id="victory-score-b" class="victory-value">0</div>
          <div class="victory-label">目标分数</div>
          <div id="victory-target" class="victory-value">5000</div>
        </div>
        <button id="victory-new-game-button" class="primary-button victory-button" type="button">
          回到主菜单
        </button>
      </div>
    </div>

    <div class="scene-shell">
      <canvas class="scene-canvas" aria-label="3D dice tray"></canvas>
    </div>

    <div id="status-panel" class="hud hud-bottom-left status-panel is-hidden">
      <div class="score-matrix">
        <div id="header-a" class="matrix-header">玩家 A</div>
        <div class="matrix-header matrix-center-label">目标</div>
        <div id="header-b" class="matrix-header">玩家 B</div>

        <div id="score-a" class="matrix-total">0</div>
        <div id="target-score-display" class="matrix-total matrix-center-value">5000</div>
        <div id="score-b" class="matrix-total">0</div>

        <div id="round-score-a" class="matrix-side-value">0</div>
        <div class="matrix-middle-tag">本轮</div>
        <div id="round-score-b" class="matrix-side-value">0</div>

        <div id="selected-score-a" class="matrix-side-value">0</div>
        <div class="matrix-middle-tag">选定</div>
        <div id="selected-score-b" class="matrix-side-value">0</div>
      </div>
    </div>

    <div id="action-panel" class="hud hud-bottom-right action-panel is-hidden">
      <div class="hud-title">操作</div>
      <div class="button-grid">
        <button id="roll-button" type="button">掷骰</button>
        <button id="bank-button" type="button">保存分数并结束回合</button>
      </div>
      <div class="action-hints" aria-label="keyboard shortcuts">
        <div class="action-hint-row"><span class="shortcut-key">F</span><span>掷骰 / 继续掷骰</span></div>
        <div class="action-hint-row"><span class="shortcut-key">Q</span><span>计分并结束回合</span></div>
        <div class="action-hint-row"><span class="shortcut-key">WASD / E</span><span>移动焦点 / 选中骰子</span></div>
      </div>
    </div>
  </div>
`;

const canvas = root.querySelector<HTMLCanvasElement>('.scene-canvas');

if (!canvas) {
  throw new Error('Missing scene canvas');
}

const scene = new TrayScene(canvas);
const app = new GameApp(root, scene);

scene.start();
void app.init();

window.addEventListener('beforeunload', () => {
  app.dispose();
  scene.dispose();
});
