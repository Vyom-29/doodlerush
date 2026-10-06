import { useRef, useState, type FormEvent } from "react";

import { MessageFeed } from "@/components/chat/MessageFeed";
import { DrawingCanvas } from "@/components/canvas/DrawingCanvas";
import { Scoreboard } from "@/components/scoreboard/Scoreboard";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import type { ChatEntry, DrawingStroke, GamePhase, ScoredPlayerView } from "@/game/mock-game-state";

const REACTIONS = ["😂", "🔥", "😭", "👏", "💀", "🤯"];

interface GameScreenProps {
  displayName: string;
  roomCode: string;
  playerId: string;
  players: ScoredPlayerView[];
  chat: ChatEntry[];
  roundNumber: number;
  totalRounds: number;
  drawerId: string;
  hasCurrentPlayerGuessed: boolean;
  phase: GamePhase;
  countdown: number;
  secondsLeft: number;
  answerForDrawer?: string;
  wordOptions?: string[];
  maskedWord?: string[];
  strokes: DrawingStroke[];
  redoCount: number;
  feedback: string;
  onSelectWord: (optionIndex: number) => void;
  onGuess: (guess: string) => void;
  onChat: (text: string) => void;
  onReaction: (reaction: string) => void;
  onStroke: (stroke: DrawingStroke) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export function GameScreen({
  displayName,
  roomCode,
  playerId,
  players,
  chat,
  roundNumber,
  totalRounds,
  drawerId,
  hasCurrentPlayerGuessed,
  phase,
  countdown,
  secondsLeft,
  answerForDrawer,
  wordOptions = [],
  maskedWord = [],
  strokes,
  redoCount,
  feedback,
  onSelectWord,
  onGuess,
  onChat,
  onReaction,
  onStroke,
  onUndo,
  onRedo,
  onClear,
}: GameScreenProps) {
  const [guess, setGuess] = useState("");
  const [message, setMessage] = useState("");
  const [reactionPopups, setReactionPopups] = useState<Array<{ id: number; text: string }>>([]);
  const reactionSequence = useRef(0);
  const isDrawer = drawerId === playerId;
  const drawer = players.find((player) => player.id === drawerId);
  const isWarning = phase === "DRAWING" && secondsLeft <= 10;

  function submitGuess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guess.trim()) return;
    onGuess(guess);
    setGuess("");
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    onChat(message);
    setMessage("");
  }

  function react(reaction: string) {
    const id = ++reactionSequence.current;
    setReactionPopups((current) => [...current.slice(-3), { id, text: reaction }]);
    window.setTimeout(
      () => setReactionPopups((current) => current.filter((item) => item.id !== id)),
      1500,
    );
    onReaction(reaction);
  }

  return (
    <main className="app-shell game-shell">
      <header className="game-topbar">
        <BrandMark compact />
        <div className="game-round-label">
          <span>ROUND</span>
          <strong>
            {roundNumber}
            <small> / {totalRounds}</small>
          </strong>
        </div>
        <div
          className={`game-timer${isWarning ? " game-timer--warning" : ""}`}
          aria-label={`${secondsLeft} seconds remaining`}
        >
          <span aria-hidden="true">◷</span>
          <strong>{phase === "COUNTDOWN" ? countdown : secondsLeft}</strong>
          <small>SEC</small>
        </div>
        <div className="game-state-chip">
          <i className={phase === "DRAWING" ? "live-dot" : "status-dot"} />
          {phase === "COUNTDOWN"
            ? "Get ready"
            : phase === "WORD_SELECTION"
              ? "Pick a word"
              : "Round in play"}
        </div>
        <div className="game-room-code">
          <span>ROOM</span>
          <strong>{roomCode}</strong>
        </div>
      </header>

      <div className="game-layout">
        <aside className="panel game-score-panel" aria-labelledby="leaderboard-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">THE RACE</p>
              <h2 id="leaderboard-title">Leaderboard</h2>
            </div>
            <span className="panel-icon panel-icon--gold" aria-hidden="true">
              ♛
            </span>
          </div>
          <Scoreboard players={players} currentPlayerId={playerId} drawerId={drawerId} compact />
          <div className="streak-note">
            <span aria-hidden="true">🔥</span>
            <span>
              <strong>Keep the streak alive</strong>
              <small>Quick guesses earn bonus points</small>
            </span>
          </div>
        </aside>

        <section className="game-stage" aria-label="Drawing round">
          <div className="stage-heading">
            <div className="drawer-presence">
              <AvatarBadge
                emoji={drawer?.avatar ?? "✎"}
                name={drawer?.name ?? "Drawer"}
                size="small"
              />
              <span>
                <strong>
                  {isDrawer ? "Your turn to draw" : `${drawer?.name ?? "A player"} is drawing`}
                </strong>
                <small>{isDrawer ? "Make it a good one" : "Watch closely and guess"}</small>
              </span>
            </div>
            {phase === "DRAWING" && isDrawer && answerForDrawer ? (
              <div className="secret-word-label">
                YOUR WORD <strong>{answerForDrawer}</strong>
              </div>
            ) : null}
            {phase === "DRAWING" && !isDrawer ? (
              <div className="guess-streak-chip">
                🔥 {players.find((player) => player.id === playerId)?.streak ?? 0} streak
              </div>
            ) : null}
          </div>

          {feedback ? (
            <p className="game-feedback" role="status" aria-live="polite">
              {feedback}
            </p>
          ) : (
            <div className="stage-spacer" />
          )}

          {phase === "COUNTDOWN" ? (
            <div className="countdown-card" role="status" aria-live="assertive">
              <span className="countdown-spark" aria-hidden="true">
                ✦
              </span>
              <p className="eyebrow">ROUND {roundNumber} STARTING</p>
              <strong>{countdown}</strong>
              <span>Get your guessing brain ready</span>
            </div>
          ) : null}

          {phase === "WORD_SELECTION" && isDrawer ? (
            <div className="word-pick-card">
              <p className="eyebrow">PICK YOUR SECRET WORD</p>
              <h1>What are you drawing?</h1>
              <p>Your word stays hidden from everyone else.</p>
              <div className="word-choice-grid">
                {wordOptions.map((word, index) => (
                  <button
                    className="word-choice"
                    type="button"
                    key={word}
                    onClick={() => onSelectWord(index)}
                  >
                    <span>0{index + 1}</span>
                    <strong>{word}</strong>
                    <i aria-hidden="true">↗</i>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {phase === "DRAWING" ? (
            <>
              {!isDrawer ? (
                <div className="guess-prompt" aria-label="Guess the word">
                  <span>GUESS THIS</span>
                  <div className="masked-word" aria-live="polite">
                    {maskedWord.map((letter, index) => (
                      <span key={`${index}-${letter}`}>{letter || "_"}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="drawer-hint">
                  <span aria-hidden="true">✎</span> Draw clues, not letters!
                </div>
              )}
              <DrawingCanvas
                strokes={strokes}
                canDraw={isDrawer}
                redoCount={redoCount}
                onStroke={onStroke}
                onUndo={onUndo}
                onRedo={onRedo}
                onClear={onClear}
              />
            </>
          ) : null}
        </section>

        <aside className="panel game-chat-panel" aria-labelledby="game-chat-title">
          <div className="panel-heading game-chat-heading">
            <div>
              <p className="eyebrow">LIVE ROOM</p>
              <h2 id="game-chat-title">Guesses & chat</h2>
            </div>
            <span className="online-count">
              <i /> {players.length}
            </span>
          </div>
          <MessageFeed
            messages={chat}
            players={players}
            className="game-message-feed"
            emptyText="Waiting for the first guess…"
          />
          <div className="reaction-bar" aria-label="Send a reaction">
            {REACTIONS.map((reaction) => (
              <button
                key={reaction}
                type="button"
                onClick={() => react(reaction)}
                aria-label={`React ${reaction}`}
              >
                {reaction}
              </button>
            ))}
          </div>
          <div className="reaction-popups" aria-live="polite" aria-relevant="additions">
            {reactionPopups.map((popup) => (
              <span className="reaction-popup" key={popup.id}>
                {popup.text}
              </span>
            ))}
          </div>
          {phase === "DRAWING" && !isDrawer && !hasCurrentPlayerGuessed ? (
            <form className="guess-composer" onSubmit={submitGuess}>
              <label htmlFor="guess-input">Type your guess</label>
              <div>
                <input
                  id="guess-input"
                  value={guess}
                  onChange={(event) => setGuess(event.target.value)}
                  maxLength={40}
                  placeholder="Type your guess…"
                  autoComplete="off"
                />
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={!guess.trim()}
                  aria-label="Submit guess"
                >
                  SEND ↗
                </button>
              </div>
            </form>
          ) : null}
          {phase === "DRAWING" && hasCurrentPlayerGuessed ? (
            <p className="already-guessed">
              <span aria-hidden="true">🎉</span> Nice one! You got it. Cheer on the others!
            </p>
          ) : null}
          <form className="chat-composer game-chat-composer" onSubmit={submitMessage}>
            <label className="visually-hidden" htmlFor="game-chat-input">
              Send a chat message
            </label>
            <input
              id="game-chat-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={140}
              placeholder="Cheer them on…"
            />
            <button
              className="send-button"
              type="submit"
              disabled={!message.trim()}
              aria-label="Send chat message"
            >
              ↗
            </button>
          </form>
          <p className="chat-room-note">
            Drawing as <strong>{drawer?.name ?? displayName}</strong>
          </p>
        </aside>
      </div>
    </main>
  );
}
