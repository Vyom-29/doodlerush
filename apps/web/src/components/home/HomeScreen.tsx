import { useState } from "react";

import { AVATARS } from "@/game/mock-players";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { BrandMark } from "@/components/ui/BrandMark";

interface HomeScreenProps {
  displayName: string;
  avatar: string;
  nameError?: string;
  roomCodeError?: string;
  statusText?: string;
  serverError?: string;
  onNameChange: (name: string) => void;
  onAvatarChange: (avatar: string) => void;
  onRandomAvatar: () => void;
  onQuickPlay: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (roomCode: string) => void;
}

export function HomeScreen({
  displayName,
  avatar,
  nameError,
  roomCodeError,
  statusText = "Connected to room server",
  serverError,
  onNameChange,
  onAvatarChange,
  onRandomAvatar,
  onQuickPlay,
  onCreateRoom,
  onJoinRoom,
}: HomeScreenProps) {
  const [roomCode, setRoomCode] = useState("");
  const selectedIndex = Math.max(
    0,
    AVATARS.findIndex((choice) => choice.emoji === avatar),
  );

  function shiftAvatar(direction: -1 | 1) {
    const nextIndex = (selectedIndex + direction + AVATARS.length) % AVATARS.length;
    onAvatarChange(AVATARS[nextIndex].emoji);
  }

  function submitJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoinRoom(roomCode);
  }

  return (
    <main className="app-shell home-shell">
      <header className="site-header">
        <BrandMark />
        <div className="header-note">
          <span className="status-dot" aria-hidden="true" />
          {statusText}
        </div>
      </header>

      <div className="home-layout">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="hero-kicker">
            <span className="kicker-star" aria-hidden="true">
              ✦
            </span>
            A little sketch. A lot of chaos.
          </div>
          <h1 id="home-title">
            Draw it.
            <br />
            <span>Guess it.</span> Win it.
          </h1>
          <p className="hero-tagline">Draw it. Guess it. Win it.</p>
          <p className="hero-copy">
            Grab your friends, pick up a pretend marker, and see who can turn a wild guess into a
            winning streak.
          </p>

          <div className="hero-preview" aria-label="A preview of a lively DoodleRush round">
            <div className="preview-topline">
              <span>
                <span className="live-dot" aria-hidden="true" /> ROUND IN PROGRESS
              </span>
              <span className="preview-timer">00:42</span>
            </div>
            <div className="preview-art" aria-hidden="true">
              <span className="preview-orbit orbit-one" />
              <span className="preview-orbit orbit-two" />
              <span className="preview-rocket">🚀</span>
              <span className="preview-scribble scribble-one">✳</span>
              <span className="preview-scribble scribble-two">〰</span>
            </div>
            <div className="preview-bottomline">
              <div className="preview-players">
                <AvatarBadge emoji="🐼" name="Panda player" size="small" />
                <AvatarBadge emoji="🦊" name="Fox player" size="small" />
                <AvatarBadge emoji="👻" name="Ghost player" size="small" />
                <span className="preview-count">+2</span>
              </div>
              <span className="preview-chat">“space banana?”</span>
            </div>
          </div>

          <div className="home-perks" aria-label="Game highlights">
            <span>
              <i className="perk-dot perk-dot--coral" /> Fast rounds
            </span>
            <span>
              <i className="perk-dot perk-dot--mint" /> Big guesses
            </span>
            <span>
              <i className="perk-dot perk-dot--gold" /> Zero pressure
            </span>
          </div>
        </section>

        <section className="entry-card" aria-labelledby="entry-title">
          <div className="entry-card-top">
            <div>
              <p className="eyebrow">YOUR NEXT GREAT DOODLE</p>
              <h2 id="entry-title">Jump in</h2>
            </div>
            <span className="entry-card-sticker" aria-hidden="true">
              ✎
            </span>
          </div>

          <div className="field-group">
            <label htmlFor="display-name">Display name</label>
            <div className={`text-field${nameError ? " text-field--error" : ""}`}>
              <input
                id="display-name"
                value={displayName}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="What should we call you?"
                autoComplete="nickname"
                maxLength={20}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "name-error name-counter" : "name-counter"}
              />
              <span id="name-counter" className="input-counter">
                {displayName.length}/20
              </span>
            </div>
            {nameError ? (
              <p className="field-error" id="name-error">
                {nameError}
              </p>
            ) : null}
          </div>

          <fieldset className="avatar-picker">
            <legend>Your avatar</legend>
            <div className="avatar-picker-row">
              <button
                className="icon-button avatar-arrow"
                type="button"
                onClick={() => shiftAvatar(-1)}
                aria-label="Previous avatar"
              >
                ‹
              </button>
              <div className="avatar-selected" aria-live="polite">
                <AvatarBadge emoji={avatar} name="Selected" size="large" />
                <span>{AVATARS[selectedIndex]?.label ?? "Player"}</span>
              </div>
              <button
                className="icon-button avatar-arrow"
                type="button"
                onClick={() => shiftAvatar(1)}
                aria-label="Next avatar"
              >
                ›
              </button>
              <button
                className="random-avatar"
                type="button"
                onClick={onRandomAvatar}
                aria-label="Choose a random avatar"
              >
                🎲 <span>Surprise me</span>
              </button>
            </div>
            <div className="avatar-quick-grid" aria-label="Choose an avatar">
              {AVATARS.slice(0, 12).map((choice) => (
                <button
                  className={`avatar-choice${choice.emoji === avatar ? " avatar-choice--selected" : ""}`}
                  type="button"
                  key={`${choice.label}-${choice.emoji}`}
                  onClick={() => onAvatarChange(choice.emoji)}
                  aria-label={`Choose ${choice.label} avatar`}
                  aria-pressed={choice.emoji === avatar}
                >
                  {choice.emoji}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="entry-actions">
            <button
              className="button button--primary button--large"
              type="button"
              onClick={onQuickPlay}
            >
              <span>Quick play</span>
              <span aria-hidden="true">↗</span>
            </button>
            <button
              className="button button--secondary button--large"
              type="button"
              onClick={onCreateRoom}
            >
              <span className="button-icon" aria-hidden="true">
                ＋
              </span>
              Create private room
            </button>
          </div>

          <div className="join-divider">
            <span>or join a room</span>
          </div>
          <form className="join-form" onSubmit={submitJoin} noValidate>
            <label htmlFor="room-code">Room code</label>
            <div className="join-input-row">
              <input
                id="room-code"
                className={`room-code-input${roomCodeError ? " room-code-input--error" : ""}`}
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-HJ-NP-Z2-9]/g, "")
                      .slice(0, 8),
                  )
                }
                placeholder="ABCD2345"
                autoComplete="off"
                maxLength={8}
                aria-invalid={Boolean(roomCodeError)}
                aria-describedby={roomCodeError ? "room-code-error" : undefined}
              />
              <button className="button button--join" type="submit">
                Join room
              </button>
            </div>
            {roomCodeError ? (
              <p className="field-error" id="room-code-error">
                {roomCodeError}
              </p>
            ) : null}
          </form>

          <p className="entry-footnote">
            <span aria-hidden="true">✦</span> No sign-up. Just doodle.
          </p>
          {serverError ? (
            <p className="field-error" role="status">
              {serverError}
            </p>
          ) : null}
        </section>
      </div>

      <footer className="home-footer">
        <span>Made for questionable masterpieces.</span>
        <span>Pick a word. Make a mess. Have a good time.</span>
      </footer>
    </main>
  );
}
