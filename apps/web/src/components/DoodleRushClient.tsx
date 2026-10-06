"use client";

import { GameResultsScreen } from "@/components/results/GameResultsScreen";
import { RoundResultsScreen } from "@/components/results/RoundResultsScreen";
import { GameScreen } from "@/components/game/GameScreen";
import { HomeScreen } from "@/components/home/HomeScreen";
import { LobbyScreen } from "@/components/lobby/LobbyScreen";
import { useRealtimeGame } from "@/game/use-realtime-game";

export function DoodleRushClient() {
  const game = useRealtimeGame();
  const room = game.room;
  const isHost = Boolean(room && room.hostId === game.playerId);

  function renderNotice() {
    return game.serverError ? (
      <div className="server-notice" role="alert">
        <span>{game.serverError}</span>
        <button type="button" onClick={game.clearServerError} aria-label="Dismiss message">
          ×
        </button>
      </div>
    ) : null;
  }

  if (game.screen === "HOME") {
    return (
      <>
        {renderNotice()}
        <HomeScreen
          displayName={game.displayName}
          avatar={game.avatar}
          nameError={game.homeErrors.name}
          roomCodeError={game.homeErrors.roomCode}
          statusText={game.statusText}
          onNameChange={game.setDisplayName}
          onAvatarChange={game.setAvatar}
          onRandomAvatar={game.randomizeAvatar}
          onQuickPlay={game.createRoom}
          onCreateRoom={game.createRoom}
          onJoinRoom={game.joinRoom}
        />
      </>
    );
  }

  if (!room) return null;

  if (game.screen === "LOBBY") {
    return (
      <>
        {renderNotice()}
        <LobbyScreen
          roomCode={room.code}
          playerId={game.playerId}
          hostId={room.hostId}
          players={game.players}
          settings={game.settings}
          chat={game.chat}
          onSettingChange={game.changeSetting}
          onStartGame={game.startGame}
          onKickPlayer={game.kickPlayer}
          onSendChat={game.sendChat}
          onReturnHome={game.returnHome}
        />
      </>
    );
  }

  if (game.screen === "ROUND_RESULTS" && game.game) {
    return (
      <>
        {renderNotice()}
        <RoundResultsScreen
          game={game.game}
          players={game.scoredPlayers}
          correctGuesserIds={game.correctPlayerIds}
          playerId={game.playerId}
          canAdvance={isHost}
          onNextRound={game.nextRound}
        />
      </>
    );
  }

  if (game.screen === "GAME_RESULTS" && game.results) {
    return (
      <>
        {renderNotice()}
        <GameResultsScreen
          players={game.players}
          results={game.results}
          playerId={game.playerId}
          canHostActions={isHost}
          onPlayAgain={game.playAgain}
          onReturnLobby={game.returnLobby}
          onReturnHome={game.returnHome}
        />
      </>
    );
  }

  if (!game.game) return null;
  const currentGame = game.game;
  const isDrawer = currentGame.drawerId === game.playerId;
  const publicGame = room.game;

  return (
    <>
      {renderNotice()}
      <GameScreen
        displayName={game.displayName}
        roomCode={room.code}
        playerId={game.playerId}
        players={game.scoredPlayers}
        chat={game.chat}
        roundNumber={currentGame.roundNumber}
        totalRounds={currentGame.totalRounds}
        drawerId={currentGame.drawerId}
        hasCurrentPlayerGuessed={publicGame?.correctPlayerIds.includes(game.playerId) ?? false}
        phase={currentGame.phase}
        countdown={0}
        secondsLeft={currentGame.secondsLeft}
        answerForDrawer={
          isDrawer && currentGame.phase === "DRAWING"
            ? (currentGame.answer ?? undefined)
            : undefined
        }
        wordOptions={
          isDrawer && currentGame.phase === "WORD_SELECTION" ? currentGame.wordOptions : []
        }
        maskedWord={!isDrawer ? (publicGame?.maskedWord ?? []) : []}
        strokes={currentGame.strokes}
        redoCount={publicGame?.redoCount ?? 0}
        feedback={game.feedback}
        onSelectWord={game.selectWord}
        onGuess={game.submitGuess}
        onChat={game.sendChat}
        onReaction={game.sendReaction}
        onStroke={game.addStroke}
        onUndo={() => game.drawingAction("undo")}
        onRedo={() => game.drawingAction("redo")}
        onClear={() => game.drawingAction("clear")}
      />
    </>
  );
}
