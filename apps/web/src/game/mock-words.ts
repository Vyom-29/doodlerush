const WORDS = [
  ["ROCKET", "VOLCANO", "PENGUIN"],
  ["RAINBOW", "CACTUS", "POPCORN"],
  ["CASTLE", "TURTLE", "BANANA"],
  ["GUITAR", "PIZZA", "OCTOPUS"],
  ["DOLPHIN", "CUPCAKE", "PLANET"],
];

export function getWordChoices(roundNumber: number, count: number): string[] {
  const source = WORDS[(roundNumber - 1) % WORDS.length];
  return source.slice(0, count);
}

export function getMockDrawerWord(): string {
  return "ROCKET";
}

export function getRevealedPositions(answer: string, count: number): number[] {
  const letters = [...answer]
    .map((letter, index) => (letter !== " " ? index : -1))
    .filter((i) => i >= 0);
  if (letters.length <= 2 || count <= 0) return [];

  const candidates = [Math.floor(letters.length / 2), 1, Math.max(0, letters.length - 2)];
  const positions: number[] = [];
  for (const candidate of candidates) {
    const index = letters[Math.min(candidate, letters.length - 1)];
    if (index !== undefined && !positions.includes(index)) positions.push(index);
    if (positions.length === count) break;
  }
  return positions;
}
