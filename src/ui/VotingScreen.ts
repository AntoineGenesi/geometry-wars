/**
 * VotingScreen — Phase 3 stub.
 *
 * This is a minimal placeholder so the network-main.ts wiring compiles.
 * Phase 3 (s26-mp-lobby-p3-voting-ui) replaces this with the full implementation.
 *
 * The stub shows a simple overlay with:
 * - "VOTING IN PROGRESS" title
 * - Countdown timer
 * - Current vote tally
 * - A "RETURN TO MENU" button
 */

import type { NetworkGameState } from '../network/NetworkClient';

export interface VotingScreenCallbacks {
  /** Called when local player votes for a choice */
  onVote?: (choice: string) => void;
  /** Called when host wants to launch with a specific choice (host only) */
  onHostLaunch?: (choice: string) => void;
  /** Called when player wants to return to main menu */
  onReturnToMenu?: () => void;
}

export class VotingScreen {
  private container: HTMLDivElement;
  private callbacks: VotingScreenCallbacks = {};

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'voting-screen';
    this.applyStyles();
    this.container.classList.add('hidden');
    document.body.appendChild(this.container);
  }

  private applyStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      #voting-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 20, 0.92);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 3100;
        font-family: 'Segoe UI', Arial, sans-serif;
        backdrop-filter: blur(8px);
      }
      #voting-screen.hidden { display: none; }
      #voting-screen .vs-title {
        font-size: 48px;
        font-weight: bold;
        color: #00ffff;
        text-shadow: 0 0 20px #00ffff;
        letter-spacing: 6px;
        margin-bottom: 16px;
      }
      #voting-screen .vs-subtitle {
        color: #668888;
        font-size: 14px;
        letter-spacing: 3px;
        margin-bottom: 32px;
      }
      #voting-screen .vs-countdown {
        font-size: 64px;
        font-weight: bold;
        color: #ffff00;
        text-shadow: 0 0 20px #ffff00;
        margin-bottom: 24px;
        min-height: 80px;
      }
      #voting-screen .vs-votes {
        color: #88ffff;
        font-size: 16px;
        letter-spacing: 2px;
        margin-bottom: 40px;
        text-align: center;
        max-width: 400px;
      }
      #voting-screen .vs-return-btn {
        background: rgba(0, 0, 40, 0.8);
        border: 2px solid #ff4444;
        color: #ff4444;
        padding: 14px 40px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
        letter-spacing: 3px;
        transition: all 0.2s;
      }
      #voting-screen .vs-return-btn:hover {
        background: rgba(80, 0, 0, 0.8);
        box-shadow: 0 0 20px #ff4444;
      }
    `;
    document.head.appendChild(style);
  }

  setCallbacks(callbacks: VotingScreenCallbacks): void {
    this.callbacks = callbacks;
  }

  show(state: NetworkGameState, _isHost: boolean, _localPlayerId: string): void {
    const countdown = Math.ceil(state.votingCountdown);
    const countdownStr = countdown > 0 ? `${countdown}` : '';

    // Summarize votes
    const voteEntries: string[] = [];
    state.voteMap.forEach((choice: string, _sessionId: string) => {
      voteEntries.push(choice);
    });
    const voteSummary = voteEntries.length > 0
      ? voteEntries.join(', ')
      : 'No votes yet';

    this.container.innerHTML = `
      <div class="vs-title">VOTING IN PROGRESS</div>
      <div class="vs-subtitle">Phase 3 stub — full UI coming soon</div>
      <div class="vs-countdown">${countdownStr}</div>
      <div class="vs-votes">Votes: ${voteSummary}</div>
      <button class="vs-return-btn">RETURN TO MENU</button>
    `;

    const returnBtn = this.container.querySelector('.vs-return-btn');
    returnBtn?.addEventListener('click', () => {
      this.callbacks.onReturnToMenu?.();
    });

    this.container.classList.remove('hidden');
  }

  /** Update the display without rebuilding (called on each state change during voting) */
  update(state: NetworkGameState, isHost: boolean, localPlayerId: string): void {
    // Re-render the stub. Phase 3 will optimize this.
    this.show(state, isHost, localPlayerId);
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  dispose(): void {
    this.container.remove();
  }
}
