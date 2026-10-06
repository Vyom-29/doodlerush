import { AvatarBadge } from "@/components/ui/AvatarBadge";
import type { ScoredPlayerView } from "@/game/mock-game-state";

interface ScoreboardProps {
  players: ScoredPlayerView[];
  currentPlayerId?: string;
  drawerId?: string;
  compact?: boolean;
  preserveOrder?: boolean;
}

export function Scoreboard({
  players,
  currentPlayerId,
  drawerId,
  compact = false,
  preserveOrder = false,
}: ScoreboardProps) {
  const ranked = preserveOrder
    ? players
    : [...players].sort((first, second) => second.score - first.score);

  return (
    <ol className={`score-list${compact ? " score-list--compact" : ""}`}>
      {ranked.map((player, index) => (
        <li
          className={`score-player${player.id === currentPlayerId ? " score-player--self" : ""}${player.id === drawerId ? " score-player--drawer" : ""}`}
          key={player.id}
        >
          <span className="score-rank" aria-label={`Rank ${index + 1}`}>
            {index < 3 ? ["🥇", "🥈", "🥉"][index] : index + 1}
          </span>
          <AvatarBadge emoji={player.avatar} name={player.name} size="small" />
          <span className="score-player-name">
            <strong>{player.name}</strong>
            {player.id === currentPlayerId ? <small>You</small> : null}
            {player.id === drawerId ? <small>Drawing</small> : null}
          </span>
          <strong className="score-value">{player.score.toLocaleString()}</strong>
        </li>
      ))}
    </ol>
  );
}
