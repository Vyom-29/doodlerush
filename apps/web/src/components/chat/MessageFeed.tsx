import type { ChatEntry, MockPlayer } from "@/game/mock-game-state";
import { AvatarBadge } from "@/components/ui/AvatarBadge";

interface MessageFeedProps {
  messages: ChatEntry[];
  players: MockPlayer[];
  emptyText?: string;
  className?: string;
}

export function MessageFeed({
  messages,
  players,
  emptyText = "The chat is quiet. Start the fun!",
  className = "",
}: MessageFeedProps) {
  return (
    <div
      className={`message-feed ${className}`}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.length === 0 ? <p className="message-empty">{emptyText}</p> : null}
      {messages.map((message) => {
        if (message.kind === "system") {
          return (
            <p className="message-system" key={message.id}>
              <span aria-hidden="true">✦</span> {message.text}
            </p>
          );
        }
        const isCorrect = message.kind === "correct";
        const sender = players.find((player) => player.id === message.playerId);
        return (
          <article
            className={`message-row${isCorrect ? " message-row--correct" : ""}`}
            key={message.id}
          >
            <AvatarBadge
              emoji={sender?.avatar ?? "✦"}
              name={message.playerName ?? "Player"}
              size="small"
            />
            <p>
              <strong>{message.playerName ?? "Player"}</strong>
              <span>{message.text}</span>
            </p>
            {isCorrect ? (
              <span className="message-check" aria-label="Correct guess">
                ✓
              </span>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
