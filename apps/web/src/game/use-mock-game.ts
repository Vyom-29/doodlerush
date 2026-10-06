"use client";

import { useEffect, useReducer } from "react";

import { gameReducer } from "./game-machine";
import { createInitialState } from "./mock-game-state";
import { getCorrectGuesserIds } from "@doodlerush/game-engine";

function findNextBot(playerIds: string[], playerId: string, drawerId: string, guessedIds: string) {
  const guessed = new Set(guessedIds.split(",").filter(Boolean));
  return playerIds.find(
    (candidateId) =>
      candidateId !== playerId && candidateId !== drawerId && !guessed.has(candidateId),
  );
}

export function useMockGame() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState);
  const game = state.game;
  const phase = game?.phase;
  const roundNumber = game?.roundNumber;
  const drawerId = game?.drawerId;
  const playerIds = state.players.map((player) => player.id).join(",");

  useEffect(() => {
    if (phase !== "COUNTDOWN" && phase !== "DRAWING") return;
    const tick = window.setInterval(() => {
      dispatch({ type: phase === "COUNTDOWN" ? "COUNTDOWN_TICK" : "GAME_TICK" });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (phase !== "NEXT_ROUND") return;
    const timeout = window.setTimeout(() => dispatch({ type: "BEGIN_COUNTDOWN" }), 700);
    return () => window.clearTimeout(timeout);
  }, [phase, roundNumber]);

  const guessedIds = game ? getCorrectGuesserIds(state.gameStats, game.roundNumber).join(",") : "";
  useEffect(() => {
    if (phase !== "DRAWING" || !drawerId) return;
    const nextBot = findNextBot(playerIds.split(","), state.playerId, drawerId, guessedIds);
    if (!nextBot) return;

    const timeout = window.setTimeout(
      () => dispatch({ type: "MOCK_BOT_GUESS", playerId: nextBot }),
      2600,
    );
    return () => window.clearTimeout(timeout);
  }, [phase, roundNumber, drawerId, guessedIds, state.playerId, playerIds]);

  useEffect(() => {
    if (phase !== "DRAWING" || !drawerId) return;
    const firstBot = playerIds
      .split(",")
      .find((candidateId) => candidateId !== state.playerId && candidateId !== drawerId);
    if (!firstBot) return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "MOCK_WRONG_GUESS", playerId: firstBot, text: "Is it a kite?" }),
      1500,
    );
    return () => window.clearTimeout(timeout);
  }, [phase, roundNumber, drawerId, state.playerId, playerIds]);

  useEffect(() => {
    if (phase !== "DRAWING" || !drawerId) return;
    const timeout = window.setTimeout(() => dispatch({ type: "MOCK_REACTION" }), 3500);
    return () => window.clearTimeout(timeout);
  }, [phase, roundNumber, drawerId]);

  useEffect(() => {
    if (!state.gameFeedback) return;
    const timeout = window.setTimeout(() => dispatch({ type: "CLEAR_FEEDBACK" }), 2600);
    return () => window.clearTimeout(timeout);
  }, [state.gameFeedback]);

  return { state, dispatch };
}
