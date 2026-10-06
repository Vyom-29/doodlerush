import { DrawingCanvas } from "@/components/canvas/DrawingCanvas";
import { Scoreboard } from "@/components/scoreboard/Scoreboard";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { BrandMark } from "@/components/ui/BrandMark";
import type { MockGameSession, ScoredPlayerView } from "@/game/mock-game-state";

interface RoundResultsScreenProps {
  game: MockGameSession;
  players: ScoredPlayerView[];
  correctGuesserIds: string[];
  playerId: string;
  onNextRound: () => void;
  canAdvance?: boolean;
}

export function RoundResultsScreen({
  game,
  players,
  correctGuesserIds,
  playerId,
  onNextRound,
  canAdvance = true,
}: RoundResultsScreenProps) {
  const drawer = players.find((player) => player.id === game.result?.drawerId);
  const currentPoints = game.result?.pointsForCurrentPlayer;

  return (
    <main className="app-shell results-shell round-results-shell">
      <header className="site-header">
        <BrandMark compact />
        <span className="results-round-chip">ROUND {game.roundNumber} COMPLETE</span>
      </header>
      <div className="round-result-layout">
        <section className="round-result-main panel">
          <div className="results-celebration" aria-hidden="true">
            ✦ 🎉 ✦
          </div>
          <p className="eyebrow">NICE ROUND, EVERYONE</p>
          <h1>
            That was a <span>good one.</span>
          </h1>
          <p className="answer-reveal-label">THE WORD WAS</p>
          <strong className="answer-reveal">{game.result?.answer ?? "—"}</strong>
          <div className="round-drawing-preview" aria-label="Completed drawing">
            <DrawingCanvas
              strokes={game.strokes}
              canDraw={false}
              emptyMessage="No strokes this round"
              onStroke={() => undefined}
              onUndo={() => undefined}
              onRedo={() => undefined}
              onClear={() => undefined}
            />
          </div>
          <div className="round-drawer-credit">
            <AvatarBadge
              emoji={drawer?.avatar ?? "✎"}
              name={drawer?.name ?? "Drawer"}
              size="small"
            />
            <span>
              <strong>{drawer?.name ?? "The drawer"}</strong> made this masterpiece
            </span>
          </div>
          <div className="correct-players">
            <h2>Guessed correctly</h2>
            {correctGuesserIds.length ? (
              <ul>
                {correctGuesserIds.map((id) => {
                  const player = players.find((entry) => entry.id === id);
                  return player ? (
                    <li key={id}>
                      <AvatarBadge emoji={player.avatar} name={player.name} size="small" />
                      <span>{player.name}</span>
                      <strong>✓</strong>
                    </li>
                  ) : null;
                })}
              </ul>
            ) : (
              <p>Time ran out before anyone got it. Better luck next round!</p>
            )}
          </div>
          {currentPoints ? (
            <div className="point-breakdown">
              <div>
                <span>Correct guess</span>
                <strong>+{currentPoints.correct}</strong>
              </div>
              <div>
                <span>Speed bonus</span>
                <strong>+{currentPoints.speed}</strong>
              </div>
              {currentPoints.streakBonus ? (
                <div>
                  <span>Streak ×{currentPoints.streak}</span>
                  <strong>+{currentPoints.streakBonus}</strong>
                </div>
              ) : null}
              <div className="point-total">
                <span>Your round score</span>
                <strong>+{currentPoints.total}</strong>
              </div>
            </div>
          ) : game.result?.drawerBonusForCurrentPlayer ? (
            <div className="drawer-point-bonus">
              <span>🎨 Drawer bonus</span>
              <strong>+{game.result.drawerBonusForCurrentPlayer}</strong>
            </div>
          ) : null}
        </section>

        <aside className="panel round-results-scoreboard">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AFTER ROUND {game.roundNumber}</p>
              <h2>Current rankings</h2>
            </div>
            <span className="panel-icon panel-icon--gold">♛</span>
          </div>
          <Scoreboard players={players} currentPlayerId={playerId} />
          <button
            className="button button--primary button--large next-round-button"
            type="button"
            onClick={onNextRound}
            disabled={!canAdvance}
          >
            {canAdvance
              ? game.roundNumber >= game.totalRounds
                ? "See final results"
                : "Next round"
              : "Waiting for host"}
            <span aria-hidden="true">→</span>
          </button>
        </aside>
      </div>
    </main>
  );
}
