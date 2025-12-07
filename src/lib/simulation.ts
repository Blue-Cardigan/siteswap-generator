export type Hand = "left" | "right";

export type Flight = {
  id: string;
  ballId: number;
  throwValue: number;
  startBeat: number;
  endBeat: number;
  fromHand: Hand;
  toHand: Hand;
};

export type SimulationPlan = {
  flights: Flight[];
  beats: number;
};

export function buildSimulationPlan(
  pattern: number[],
  balls: number,
  loops = 6,
): SimulationPlan {
  const period = pattern.length;
  const totalBeats = Math.max(loops * period, period);
  const flights: Flight[] = [];

  const catchAssignments = new Map<number, number>();
  let nextBallId = 0;

  for (let beat = 0; beat < totalBeats; beat++) {
    const throwValue = pattern[beat % period];
    const fromHand: Hand = beat % 2 === 0 ? "left" : "right";
    const toHand: Hand = (beat + throwValue) % 2 === 0 ? "left" : "right";

    let ballId: number;
    if (catchAssignments.has(beat)) {
      ballId = catchAssignments.get(beat)!;
      catchAssignments.delete(beat);
    } else {
      if (nextBallId < balls) {
        ballId = nextBallId;
        nextBallId += 1;
      } else {
        ballId = beat % balls;
      }
    }

    if (throwValue > 0) {
      const landingBeat = beat + throwValue;
      if (catchAssignments.has(landingBeat)) {
        throw new Error("Landing conflict detected while building flight plan.");
      }
      catchAssignments.set(landingBeat, ballId);
      flights.push({
        id: `${ballId}-${beat}`,
        ballId,
        throwValue,
        startBeat: beat,
        endBeat: landingBeat,
        fromHand,
        toHand,
      });
    }
  }

  return {
    flights,
    beats: totalBeats,
  };
}

