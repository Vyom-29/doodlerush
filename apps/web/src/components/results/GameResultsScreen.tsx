import type { FinalGameResults } from "@doodlerush/game-engine";

import { Scoreboard } from "@/components/scoreboard/Scoreboard";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import type { MockPlayer, ScoredPlayerView } from "@/game/mock-game-state";

interface GameResultsScreenProps {
  players: MockPlayer[];
  results: FinalGameResults;
  playerId: string;
  onPlayAgain: () => void;
  onReturnLobby: () => void;
  onReturnHome: () => void;
  canHostActions?: boolean;
}

export function GameResultsScreen({
  players,
  results,
  playerId,
  onPlayAgain,
  onReturnLobby,
  onReturnHome,
  canHostActions = true,
}: GameResultsScreenProps) {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const ranked: ScoredPlayerView[] = results.rankings.flatMap((score) => {
    const player = playersById.get(score.playerId);
    return player ? [{ ...player, score: score.score }] : [];
  });
  const winner = results.winner ? playersById.get(results.winner.playerId) : undefined;
  const awards = [
    {
      title: "Best Artist",
      icon: "🎨",
      playerId: results.awards.bestArtist?.playerId,
      detail: "Communicated the most words to the room",
    },
    {
      title: "Fastest Guesser",
      icon: "⚡",
      playerId: results.awards.fastestGuesser?.playerId,
      detail: results.awards.fastestGuesser
        ? `Average correct guess: ${Math.round(results.awards.fastestGuesser.averageGuessTimeMs / 100) / 10}s`
        : "No eligible winner",
    },
    {
      title: "Crowd Favorite",
      icon: "😂",
      playerId: results.awards.crowdFavorite?.playerId,
      detail: results.awards.crowdFavorite
        ? `${results.awards.crowdFavorite.uniqueReactors} unique reactors · ${results.awards.crowdFavorite.drawingsReactedTo} drawings`
        : "No eligible winner",
    },
    {
      title: "Streak Master",
      icon: "🔥",
      playerId: results.awards.streakMaster?.playerId,
      detail: results.awards.streakMaster
        ? `Longest streak: ${results.awards.streakMaster.longestStreak} correct guesses`
        : "No eligible winner",
    },
  ];

  return (
    <main className="app-shell results-shell final-results-shell">
      <header className="site-header">
        <BrandMark compact />
        <span className="results-round-chip">GAME COMPLETE</span>
      </header>
      <section className="winner-banner" aria-labelledby="game-over-title">
        <div className="winner-confetti" aria-hidden="true">
          <span>✦</span>
          <span>✿</span>
          <span>✧</span>
          <span>✦</span>
        </div>
        <p className="eyebrow">PENCILS DOWN, LEGENDS</p>
        <h1 id="game-over-title">
          Game <span>over!</span>
        </h1>
        <div className="winner-avatar">
          <span aria-hidden="true">🏆</span>
          <AvatarBadge emoji={winner?.avatar ?? "✦"} name={winner?.name ?? "Winner"} size="large" />
        </div>
        <p className="winner-label">DOODLE CHAMPION</p>
        <h2>{winner?.name ?? "Everyone"}</h2>
        <strong className="winner-score">
          {(results.winner?.score ?? 0).toLocaleString()} <span>points</span>
        </strong>
      </section>

      <div className="final-results-grid">
        <section className="panel final-leaderboard" aria-labelledby="final-rankings-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">THE FINAL SCORES</p>
              <h2 id="final-rankings-title">Final rankings</h2>
            </div>
            <span className="panel-icon panel-icon--gold">🏆</span>
          </div>
          <Scoreboard players={ranked} currentPlayerId={playerId} preserveOrder />
        </section>
        <section className="panel awards-panel" aria-labelledby="awards-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">A LITTLE EXTRA GLORY</p>
              <h2 id="awards-title">Special awards</h2>
            </div>
            <span className="panel-icon">✦</span>
          </div>
          <div className="award-list">
            {awards.map((award) => {
              const recipient = award.playerId ? playersById.get(award.playerId) : undefined;
              return (
                <article className="award-card" key={award.title}>
                  <span className="award-icon" aria-hidden="true">
                    {award.icon}
                  </span>
                  <div>
                    <strong>{award.title}</strong>
                    <span>{recipient?.name ?? "No eligible winner"}</span>
                    <small>{award.detail}</small>
                  </div>
                  {recipient ? (
                    <AvatarBadge emoji={recipient.avatar} name={recipient.name} size="small" />
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <div className="final-result-actions">
        <button
          className="button button--primary button--large"
          type="button"
          onClick={onPlayAgain}
          disabled={!canHostActions}
        >
          Play again <span aria-hidden="true">↻</span>
        </button>
        <button
          className="button button--secondary button--large"
          type="button"
          onClick={onReturnLobby}
          disabled={!canHostActions}
        >
          Return to lobby
        </button>
      </div>
      <button className="text-link final-home-link" type="button" onClick={onReturnHome}>
        Back to home
      </button>
    </main>
  );
}
