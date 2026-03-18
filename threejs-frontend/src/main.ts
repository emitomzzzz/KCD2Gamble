import './style.css';
import { GameApp } from './app/GameApp';
import { TrayScene } from './scene/TrayScene';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root element');
}

root.innerHTML = `
  <div class="layout">
    <div class="hud hud-top-left top-panel">
      <div class="hud-eyebrow">\u7b2c\u4e94\u9636\u6bb5 / Three.js + Python Engine + UX Polish</div>
      <h1>KCD2Gamble 3D \u6398\u9ab0\u53f0</h1>
      <p class="intro">
        \u5f53\u524d\u9636\u6bb5\u5728\u4fdd\u7559 Python \u89c4\u5219\u5c42\u7684\u524d\u63d0\u4e0b\uff0c\u8865\u4e0a\u4e86\u9f20\u6807\u60ac\u505c\u53cd\u9988\u3001\u63a5\u89e6\u9634\u5f71\u3001\u56de\u5408\u6d41\u7a0b\u63d0\u793a\u548c\u6784\u5efa\u62c6\u5305\u4f18\u5316\u3002
      </p>
      <div class="form-grid">
        <label class="field">
          <span>\u76ee\u6807\u5206\u6570</span>
          <input id="target-score" type="number" min="1" step="1" value="5000" />
        </label>
        <label class="field">
          <span>\u968f\u673a\u79cd\u5b50</span>
          <input id="seed-value" type="number" step="1" placeholder="\u53ef\u9009" />
        </label>
      </div>
      <div class="toolbar">
        <button id="new-game-button" class="primary-button" type="button">
          \u5f00\u59cb\u65b0\u5bf9\u5c40
        </button>
        <span id="connection-badge" class="badge badge-offline">
          \u540e\u7aef\u672a\u8fde\u63a5
        </span>
      </div>
    </div>

    <div id="phase-banner" class="phase-banner" aria-live="polite"></div>
    <div id="center-notice" class="center-notice" aria-live="assertive"></div>

    <div class="scene-shell">
      <canvas class="scene-canvas" aria-label="3D dice tray"></canvas>
    </div>

    <div class="hud hud-bottom-left status-panel">
      <div class="score-matrix">
        <div id="header-a" class="matrix-header">\u73a9\u5bb6 A</div>
        <div class="matrix-header matrix-center-label">\u76ee\u6807</div>
        <div id="header-b" class="matrix-header">\u73a9\u5bb6 B</div>

        <div id="score-a" class="matrix-total">0</div>
        <div id="target-score-display" class="matrix-total matrix-center-value">5000</div>
        <div id="score-b" class="matrix-total">0</div>

        <div id="round-score-a" class="matrix-side-value">0</div>
        <div class="matrix-middle-tag">\u672c\u8f6e</div>
        <div id="round-score-b" class="matrix-side-value">0</div>

        <div id="selected-score-a" class="matrix-side-value">0</div>
        <div class="matrix-middle-tag">\u9009\u5b9a</div>
        <div id="selected-score-b" class="matrix-side-value">0</div>
      </div>
    </div>

    <div class="hud hud-bottom-right action-panel">
      <div class="hud-title">\u64cd\u4f5c</div>
      <div class="button-grid">
        <button id="roll-button" type="button">\u63b7\u9ab0</button>
        <button id="bank-button" type="button">\u4fdd\u5b58\u5206\u6570\u5e76\u7ed3\u675f\u56de\u5408</button>
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
