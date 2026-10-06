const WORDS = [
  ["ROCKET", "VOLCANO", "PENGUIN"],
  ["RAINBOW", "CACTUS", "POPCORN"],
  ["CASTLE", "TURTLE", "BANANA"],
  ["GUITAR", "PIZZA", "OCTOPUS"],
  ["DOLPHIN", "CUPCAKE", "PLANET"],
];

export function getWordChoices(roundNumber: number, count: number): string[] {
  const source = WORDS[(Math.max(1, roundNumber) - 1) % WORDS.length] ?? WORDS[0];
  return source.slice(0, Math.max(1, count));
}

export function getRevealedPositions(word: string, count: number): number[] {
  const letters = [...word]
    .map((letter, index) => (letter !== " " ? index : -1))
    .filter((index) => index >= 0);
  if (letters.length <= 2 || count <= 0) return [];

  const candidates = [Math.floor(letters.length / 2), 1, Math.max(0, letters.length - 2)];
  const positions: number[] = [];
  for (const candidate of candidates) {
    const index = letters[Math.min(candidate, letters.length - 1)];
    if (index !== undefined && !positions.includes(index)) positions.push(index);
    if (positions.length >= count) break;
  }
  return positions;
}

export function normalizeGuess(guess: string): string {
  return guess.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
