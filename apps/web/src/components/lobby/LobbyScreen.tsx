import { useState } from "react";

import { MessageFeed } from "@/components/chat/MessageFeed";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import type { ChatEntry, GameSettings, MockPlayer } from "@/game/mock-game-state";

interface LobbyScreenProps {
  roomCode: string;
  playerId: string;
  hostId: string;
  players: MockPlayer[];
  settings: GameSettings;
  chat: ChatEntry[];
  onSettingChange: (setting: keyof GameSettings, value: number | string) => void;
  onStartGame: () => void;
  onKickPlayer: (playerId: string) => void;
  onSendChat: (text: string) => void;
  onReturnHome: () => void;
}

export function LobbyScreen({
  roomCode,
  playerId,
  hostId,
  players,
  settings,
  chat,
  onSettingChange,
  onStartGame,
  onKickPlayer,
  onSendChat,
  onReturnHome,
}: LobbyScreenProps) {
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const isHost = hostId === playerId;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function submitChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput);
    setChatInput("");
  }

  return (
    <main className="app-shell lobby-shell">
      <header className="site-header room-header">
        <BrandMark compact />
        <div className="room-code-header">
          <span>ROOM CODE</span>
          <strong>{roomCode}</strong>
          <button
            className="copy-button"
            type="button"
            onClick={copyCode}
            aria-label="Copy room code"
          >
            {copied ? "Copied ✓" : "Copy ↗"}
          </button>
        </div>
        <button className="header-home" type="button" onClick={onReturnHome}>
          <span aria-hidden="true">←</span> Home
        </button>
      </header>

      <div className="lobby-title-row">
        <div>
          <p className="eyebrow">THE ROOM IS OPEN</p>
          <h1>
            Waiting for the <span>first doodle.</span>
          </h1>
        </div>
        <div className="room-ready-chip">
          <span className="status-dot" /> {players.length} players ready
        </div>
      </div>

      <div className="lobby-grid">
        <section className="panel lobby-players" aria-labelledby="players-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">THE CREW</p>
              <h2 id="players-title">
                Players <span className="heading-count">{players.length}</span>
              </h2>
            </div>
            <span className="panel-icon" aria-hidden="true">
              ♧
            </span>
          </div>
          <ul className="player-list">
            {players.map((player, index) => (
              <li
                className={`lobby-player${player.id === playerId ? " lobby-player--self" : ""}`}
                key={player.id}
              >
                <AvatarBadge emoji={player.avatar} name={player.name} />
                <div className="player-identity">
                  <strong>
                    {player.name}
                    {player.id === playerId ? <span className="you-tag">YOU</span> : null}
                  </strong>
                  <span>
                    {player.id === hostId ? "Keeping the room in order" : "Ready to draw"}
                  </span>
                </div>
                {player.id === hostId ? <span className="host-tag">♛ HOST</span> : null}
                {isHost && player.id !== playerId ? (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => onKickPlayer(player.id)}
                    aria-label={`Remove ${player.name} from room`}
                  >
                    Remove
                  </button>
                ) : null}
                <span
                  className={`ready-indicator${player.isReady ? " ready-indicator--ready" : ""}`}
                  aria-label={player.isReady ? "Ready" : "Not ready"}
                >
                  {player.isReady ? "✓" : "·"}
                </span>
                {index === 0 ? <span className="first-up-tag">FIRST UP</span> : null}
              </li>
            ))}
          </ul>
          <p className="room-hint">
            <span aria-hidden="true">✦</span> Send the code to your friends and let the bad drawings
            begin.
          </p>
        </section>

        <section className="panel lobby-settings" aria-labelledby="settings-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MAKE IT YOURS</p>
              <h2 id="settings-title">Game settings</h2>
            </div>
            <span className="panel-icon panel-icon--gold" aria-hidden="true">
              ⚙
            </span>
          </div>

          <div className="settings-grid">
            <label className="setting-row">
              <span>
                <strong>Rounds</strong>
                <small>How long is the party?</small>
              </span>
              <select
                value={settings.rounds}
                disabled={!isHost}
                onChange={(event) => onSettingChange("rounds", Number(event.target.value))}
              >
                <option value={3}>3 rounds</option>
                <option value={5}>5 rounds</option>
                <option value={7}>7 rounds</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Draw time</strong>
                <small>Quick sketch or masterpiece?</small>
              </span>
              <select
                value={settings.drawSeconds}
                disabled={!isHost}
                onChange={(event) => onSettingChange("drawSeconds", Number(event.target.value))}
              >
                <option value={45}>45 seconds</option>
                <option value={60}>60 seconds</option>
                <option value={90}>90 seconds</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Word choices</strong>
                <small>Pick from a small handful</small>
              </span>
              <select
                value={settings.wordChoices}
                disabled={!isHost}
                onChange={(event) => onSettingChange("wordChoices", Number(event.target.value))}
              >
                <option value={2}>2 words</option>
                <option value={3}>3 words</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Hints</strong>
                <small>Letters appear as time passes</small>
              </span>
              <select
                value={settings.hints}
                disabled={!isHost}
                onChange={(event) => onSettingChange("hints", Number(event.target.value))}
              >
                <option value={1}>1 hint</option>
                <option value={2}>2 hints</option>
              </select>
            </label>
            <label className="setting-row setting-row--last">
              <span>
                <strong>Mode</strong>
                <small>Friendly competition</small>
              </span>
              <select
                value={settings.mode}
                disabled={!isHost}
                onChange={(event) => onSettingChange("mode", event.target.value)}
              >
                <option value="Normal">Normal</option>
                <option value="Chill">Chill</option>
              </select>
            </label>
          </div>

          <button
            className="button button--primary button--large start-button"
            type="button"
            onClick={onStartGame}
            disabled={!isHost || players.filter((player) => player.isReady).length < 2}
          >
            {isHost ? "Start game" : "Waiting for host"} <span aria-hidden="true">→</span>
          </button>
          {!isHost ? (
            <p className="settings-note">The host will start the game when everyone is ready.</p>
          ) : null}
          <p className="settings-note">You can change these again between games.</p>
        </section>

        <section className="panel lobby-chat" aria-labelledby="lobby-chat-title">
          <div className="panel-heading lobby-chat-heading">
            <div>
              <p className="eyebrow">SAY HELLO</p>
              <h2 id="lobby-chat-title">Room chat</h2>
            </div>
            <span className="online-count">
              <i /> {players.length} here
            </span>
          </div>
          <MessageFeed messages={chat} players={players} className="lobby-message-feed" />
          <form className="chat-composer" onSubmit={submitChat}>
            <label className="visually-hidden" htmlFor="lobby-message">
              Write a room message
            </label>
            <input
              id="lobby-message"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Say something nice… or weird"
              maxLength={140}
            />
            <button
              className="send-button"
              type="submit"
              disabled={!chatInput.trim()}
              aria-label="Send chat message"
            >
              ↗
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
