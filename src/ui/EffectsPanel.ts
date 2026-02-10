import type { Game } from '../core/Game';

/**
 * Debug panel for toggling visual effects in real-time.
 * Press G to toggle visibility.
 */
export class EffectsPanel {
  private container: HTMLDivElement;
  private visible = false;
  private game: Game;

  constructor(game: Game) {
    this.game = game;
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: fixed; top: 60px; right: 10px; z-index: 1000;
      background: rgba(0,0,17,0.9); border: 1px solid #0ff;
      padding: 12px; font: 13px monospace; color: #0ff;
      display: none; min-width: 220px; border-radius: 4px;
    `;
    document.body.appendChild(this.container);

    this.buildUI();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'g' || e.key === 'G') {
        this.toggle();
      }
    });
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
  }

  private buildUI(): void {
    const title = document.createElement('div');
    title.textContent = 'EFFECTS (G to close)';
    title.style.cssText = 'font-weight:bold; margin-bottom:8px; color:#ff0; text-align:center;';
    this.container.appendChild(title);

    // Bloom controls (only available with WebGL2 EffectComposer)
    if (this.game.bloomPass) {
      this.addSlider('Bloom Strength', 0, 3, this.game.bloomPass.strength, 0.1, (v) => {
        if (this.game.bloomPass) this.game.bloomPass.strength = v;
      });

      this.addSlider('Bloom Threshold', 0, 1, this.game.bloomPass.threshold, 0.05, (v) => {
        if (this.game.bloomPass) this.game.bloomPass.threshold = v;
      });

      this.addSlider('Bloom Radius', 0, 2, (this.game.bloomPass as any).radius ?? 0.4, 0.1, (v) => {
        if (this.game.bloomPass) (this.game.bloomPass as any).radius = v;
      });
    }

    // Vignette toggle (only available with WebGL2 EffectComposer)
    if (this.game.composer) {
      const vignettePass = this.game.composer.passes.find(
        (p: any) => p.uniforms?.darkness !== undefined
      );
      if (vignettePass) {
        this.addSlider('Vignette', 0, 2, (vignettePass as any).uniforms.darkness.value, 0.1, (v) => {
          (vignettePass as any).uniforms.darkness.value = v;
        });
      }
    }
  }

  private addSlider(
    label: string,
    min: number,
    max: number,
    initial: number,
    step: number,
    onChange: (v: number) => void,
  ): void {
    const row = document.createElement('div');
    row.style.cssText = 'margin: 6px 0; display:flex; align-items:center; gap:8px;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = 'flex:1; font-size:11px;';

    const val = document.createElement('span');
    val.textContent = initial.toFixed(2);
    val.style.cssText = 'width:35px; text-align:right; font-size:11px; color:#ff0;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initial);
    slider.style.cssText = 'width:80px; accent-color:#0ff;';

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(2);
      onChange(v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    this.container.appendChild(row);
  }

  dispose(): void {
    this.container.remove();
  }
}
