import {
  type ChangeEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";
import { buildSimulationPlan, type Flight, type Hand } from "./lib/simulation";
import { SiteswapError, parseSiteswap } from "./lib/siteswap";

const DEFAULT_SITESWAP = "531";
const STAGE_WIDTH = 680;
const STAGE_HEIGHT = 460;
const GROUND_Y = 392;
const SKY_BAND = STAGE_HEIGHT * 0.06;
const DWELL_RATIO = 0.2;
const MIN_FLIGHT_RATIO = 0.18;
const SCOOP_OFFSET = 34;
const SCOOP_DEPTH = 20;
const RELEASE_BASE_LIFT = 58;
const RELEASE_LIFT_PER_THROW = 15;
const MIN_APEX_LIFT = 60;
const APEX_LIFT_PER_THROW = 20;
const HAND_REST_Y = GROUND_Y - 14;
const UPPER_ARM_LENGTH = 96;
const FOREARM_LENGTH = 86;

const SHOULDER_POSITIONS: Record<Hand, { x: number; y: number }> = {
  left: {
    x: STAGE_WIDTH / 2 - 60,
    y: GROUND_Y - 150,
  },
  right: {
    x: STAGE_WIDTH / 2 + 60,
    y: GROUND_Y - 150,
  },
};

type ActiveBall = {
  id: string;
  ballId: number;
  xPercent: number;
  yPercent: number;
  color: string;
  throwValue: number;
};

type Point = {
  x: number;
  y: number;
};

type ScoopPhase = "release" | "catch";

type HandState = {
  hand: Point;
  elbow: Point;
  upperAngle: number;
  lowerAngle: number;
  upperLength: number;
  lowerLength: number;
};

type FlightTiming = {
  flight: Flight;
  releaseMs: number;
  flightMs: number;
  catchMs: number;
  totalMs: number;
  startTime: number;
  releaseAnchor: Point;
  catchAnchor: Point;
};

const createPalette = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const hue = Math.round((index / Math.max(1, count)) * 360);
    return `hsl(${hue} 80% 55%)`;
  });

const handXPosition = (hand: Hand) =>
  hand === "left" ? STAGE_WIDTH * 0.38 : STAGE_WIDTH * 0.62;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const smoothStep = (value: number) => {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
};

const getReleaseHeight = (throwValue: number) =>
  Math.max(
    SKY_BAND + 20,
    GROUND_Y - (RELEASE_BASE_LIFT + throwValue * RELEASE_LIFT_PER_THROW),
  );

const getHandAnchors = (hand: Hand) => {
  const baseX = handXPosition(hand);
  const direction = hand === "left" ? -1 : 1;
  const outerX = baseX + direction * SCOOP_OFFSET;
  const innerX = baseX - direction * (SCOOP_OFFSET * 0.35);
  return { outerX, innerX };
};

const getRestPoint = (hand: Hand): Point => {
  const { outerX } = getHandAnchors(hand);
  return { x: outerX, y: HAND_REST_Y };
};

const toCssAngle = (from: Point, to: Point) =>
  (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;

const computeArmPose = (hand: Hand, handPoint: Point): HandState => {
  const shoulder = SHOULDER_POSITIONS[hand];
  const dx = handPoint.x - shoulder.x;
  const dy = handPoint.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  const maxReach = UPPER_ARM_LENGTH + FOREARM_LENGTH - 8;
  const limitedDistance = clamp(distance, 1, maxReach);
  const scale = distance > maxReach && distance !== 0 ? maxReach / distance : 1;
  const target = {
    x: shoulder.x + dx * scale,
    y: shoulder.y + dy * scale,
  };

  const cosShoulder = clamp(
    (UPPER_ARM_LENGTH ** 2 + limitedDistance ** 2 - FOREARM_LENGTH ** 2) /
      (2 * UPPER_ARM_LENGTH * limitedDistance),
    -1,
    1,
  );
  const bendDir = hand === "left" ? 1 : -1;
  const baseAngle = Math.atan2(target.y - shoulder.y, target.x - shoulder.x);
  const shoulderOffset = Math.acos(cosShoulder);
  const upperAngleWorld = baseAngle - bendDir * shoulderOffset;
  const elbow = {
    x: shoulder.x + Math.cos(upperAngleWorld) * UPPER_ARM_LENGTH,
    y: shoulder.y + Math.sin(upperAngleWorld) * UPPER_ARM_LENGTH,
  };

  const resolvedHand = target;

  const upperAngle = toCssAngle(shoulder, elbow);
  const lowerAngle = toCssAngle(elbow, resolvedHand);

  return {
    hand: resolvedHand,
    elbow,
    upperAngle,
    lowerAngle,
    upperLength: Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y),
    lowerLength: Math.hypot(resolvedHand.x - elbow.x, resolvedHand.y - elbow.y),
  };
};

const getScoopPoint = (
  hand: Hand,
  ratio: number,
  phase: ScoopPhase,
  throwValue: number,
): Point => {
  const t = smoothStep(ratio);
  const phaseWave = Math.sin(Math.PI * clamp01(ratio)) * SCOOP_DEPTH;
  const { outerX, innerX } = getHandAnchors(hand);
  const x = outerX + (innerX - outerX) * t;

  if (phase === "release") {
    const releaseHeight = getReleaseHeight(throwValue);
    const scoopStart = HAND_REST_Y + phaseWave * 0.5;
    const y = scoopStart - (scoopStart - releaseHeight) * t;
    return { x, y };
  }

  const catchHeight = getReleaseHeight(throwValue) + 6;
  const scoopEnd = HAND_REST_Y - phaseWave * 0.35;
  const y = catchHeight + (scoopEnd - catchHeight) * t;
  return { x, y };
};

const getFlightPoint = (
  start: Point,
  end: Point,
  throwValue: number,
  progress: number,
): Point => {
  const t = clamp01(progress);
  const x = start.x + (end.x - start.x) * t;
  const apexLift = MIN_APEX_LIFT + throwValue * APEX_LIFT_PER_THROW;
  const apexY = Math.min(start.y, end.y) - apexLift;
  const y =
    (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * apexY + t * t * end.y;

  return {
    x,
    y: Math.min(GROUND_Y, Math.max(SKY_BAND, y)),
  };
};

const describeFlightTiming = (flight: Flight, beatDuration: number): FlightTiming => {
  const windowDuration = Math.max(
    flight.throwValue * beatDuration,
    beatDuration * MIN_FLIGHT_RATIO,
  );
  const minPhase = beatDuration * 0.05;
  const minFlight = beatDuration * MIN_FLIGHT_RATIO;

  let releaseMs = Math.max(minPhase, DWELL_RATIO * beatDuration);
  let catchMs = releaseMs;

  const maxPhaseBudget = Math.max(minPhase * 2, windowDuration - minFlight);
  if (releaseMs + catchMs > maxPhaseBudget) {
    const scale = maxPhaseBudget / (releaseMs + catchMs);
    releaseMs = Math.max(minPhase, releaseMs * scale);
    catchMs = Math.max(minPhase, catchMs * scale);
  }

  let flightMs = windowDuration - releaseMs - catchMs;
  if (flightMs < minFlight) {
    const deficit = minFlight - flightMs;
    const reducible = Math.max(0, releaseMs + catchMs - 2 * minPhase);
    const adjustment = Math.min(deficit, reducible) / 2;
    releaseMs = Math.max(minPhase, releaseMs - adjustment);
    catchMs = Math.max(minPhase, catchMs - adjustment);
    flightMs = windowDuration - releaseMs - catchMs;

    if (flightMs < minFlight) {
      flightMs = minFlight;
      const over = releaseMs + catchMs + flightMs - windowDuration;
      if (over > 0) {
        const reduce = over / 2;
        releaseMs = Math.max(minPhase, releaseMs - reduce);
        catchMs = Math.max(minPhase, catchMs - reduce);
        flightMs = windowDuration - releaseMs - catchMs;
      }
    }
  }

  const totalMs = releaseMs + flightMs + catchMs;
  return {
    flight,
    releaseMs,
    flightMs,
    catchMs,
    totalMs,
    startTime: flight.startBeat * beatDuration,
    releaseAnchor: getScoopPoint(flight.fromHand, 1, "release", flight.throwValue),
    catchAnchor: getScoopPoint(flight.toHand, 0, "catch", flight.throwValue),
  };
};

function App() {
  const [siteswap, setSiteswap] = useState(DEFAULT_SITESWAP);
  const [beatDuration, setBeatDuration] = useState(550);
  const [isPlaying, setIsPlaying] = useState(true);
  const [time, setTime] = useState(0);

  const parsed = useMemo(() => {
    try {
      return { data: parseSiteswap(siteswap), error: null };
    } catch (error) {
      const message =
        error instanceof SiteswapError ? error.message : "Unable to parse siteswap.";
      return { data: null, error: message };
    }
  }, [siteswap]);

  const plan = useMemo(() => {
    if (!parsed.data) {
      return null;
    }
    return buildSimulationPlan(parsed.data.pattern, parsed.data.balls);
  }, [parsed.data]);

  const totalDuration = plan ? plan.beats * beatDuration : 0;

  const flightTimings = useMemo(() => {
    if (!plan) {
      return null;
    }
    return plan.flights.map((flight) => describeFlightTiming(flight, beatDuration));
  }, [plan, beatDuration]);

  useEffect(() => {
    setTime(0);
  }, [siteswap, beatDuration]);

  useEffect(() => {
    if (!plan || totalDuration === 0) {
      return;
    }

    let frameId = 0;
    let lastFrame = performance.now();

    const step = (now: number) => {
      const delta = now - lastFrame;
      lastFrame = now;
      if (isPlaying) {
        setTime((prev) => (prev + delta) % totalDuration);
      }
      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [plan, isPlaying, totalDuration]);

  const handStates = useMemo<Record<Hand, HandState>>(() => {
    const fallback = (hand: Hand): HandState => computeArmPose(hand, getRestPoint(hand));

    if (!flightTimings || totalDuration === 0) {
      return {
        left: fallback("left"),
        right: fallback("right"),
      };
    }

    const computeState = (hand: Hand): HandState => {
      let activePoint: Point | null = null;

      for (const timing of flightTimings) {
        const normalizedStart = timing.startTime % totalDuration;
        const elapsed = (time - normalizedStart + totalDuration) % totalDuration;
        if (elapsed > timing.totalMs) {
          continue;
        }

        if (timing.flight.fromHand === hand && elapsed <= timing.releaseMs) {
          const ratio =
            timing.releaseMs > 0 ? clamp01(elapsed / timing.releaseMs) : 1;
          activePoint = getScoopPoint(hand, ratio, "release", timing.flight.throwValue);
          break;
        }

        const catchStart = timing.releaseMs + timing.flightMs;
        if (
          timing.flight.toHand === hand &&
          elapsed >= catchStart &&
          elapsed <= catchStart + timing.catchMs
        ) {
          const ratio =
            timing.catchMs > 0 ? clamp01((elapsed - catchStart) / timing.catchMs) : 1;
          activePoint = getScoopPoint(hand, ratio, "catch", timing.flight.throwValue);
          break;
        }
      }

      const target = activePoint ?? getRestPoint(hand);
      return computeArmPose(hand, target);
    };

    return {
      left: computeState("left"),
      right: computeState("right"),
    };
  }, [flightTimings, totalDuration, time]);

  const palette = useMemo(
    () => (parsed.data ? createPalette(parsed.data.balls) : []),
    [parsed.data],
  );

  const activeBalls: ActiveBall[] = useMemo(() => {
    if (!flightTimings || totalDuration === 0 || palette.length === 0) {
      return [];
    }

    return flightTimings
      .map((timing) => {
        if (timing.totalMs <= 0) {
          return null;
        }

        const normalizedStart = timing.startTime % totalDuration;
        const elapsed = (time - normalizedStart + totalDuration) % totalDuration;
        if (elapsed > timing.totalMs) {
          return null;
        }

        const { flight } = timing;
        let point: Point | null = null;

        if (elapsed <= timing.releaseMs) {
          point = handStates[flight.fromHand]?.hand ?? null;
        } else if (elapsed <= timing.releaseMs + timing.flightMs) {
          const progress =
            timing.flightMs > 0 ? (elapsed - timing.releaseMs) / timing.flightMs : 1;
          point = getFlightPoint(
            timing.releaseAnchor,
            timing.catchAnchor,
            flight.throwValue,
            progress,
          );
        } else {
          point = handStates[flight.toHand]?.hand ?? null;
        }

        if (!point) {
          return null;
        }

        return {
          id: flight.id,
          ballId: flight.ballId,
          throwValue: flight.throwValue,
          xPercent: (point.x / STAGE_WIDTH) * 100,
          yPercent: (point.y / STAGE_HEIGHT) * 100,
          color: palette[flight.ballId % palette.length],
        };
      })
      .filter((ball): ball is ActiveBall => Boolean(ball));
  }, [flightTimings, totalDuration, time, palette, handStates]);

  const handleTempoChange = (event: ChangeEvent<HTMLInputElement>) => {
    setBeatDuration(Number(event.target.value));
  };

  const stats =
    parsed.data &&
    `${parsed.data.balls} ball${parsed.data.balls === 1 ? "" : "s"} • period ${
      parsed.data.period
    }`;

  const stageStyle = useMemo<CSSProperties>(
    () => ({
      "--stage-width": `${STAGE_WIDTH}px`,
      "--stage-ratio": `${STAGE_WIDTH} / ${STAGE_HEIGHT}`,
    }),
    [],
  );

  return (
    <div className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Siteswap visualizer</p>
          <h1>Juggling animator</h1>
          <p className="subtitle">
            Enter a siteswap (e.g. 3, 423, 531) and watch the throws loop in time.
          </p>
        </div>
        <div className="controls">
          <label className="field">
            <span>Siteswap</span>
            <input
              value={siteswap}
              onChange={(event) => setSiteswap(event.target.value)}
              placeholder="531"
              spellCheck={false}
              aria-label="Siteswap"
            />
          </label>
          <label className="field">
            <span>Tempo {Math.round(60000 / beatDuration)} bpm</span>
            <input
              type="range"
              min={300}
              max={900}
              step={10}
              value={beatDuration}
              onChange={handleTempoChange}
            />
          </label>
          <button type="button" className="ghost" onClick={() => setIsPlaying((prev) => !prev)}>
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </header>

      <section className="stage-card">
        <div
          className="stage"
          role="img"
          aria-label="Siteswap animation canvas"
          style={stageStyle}
        >
          <div className="juggler">
            <div className="torso" />
            <div className="head" />
            {(["left", "right"] as Hand[]).map((hand) => {
              const state = handStates[hand];
              const shoulder = SHOULDER_POSITIONS[hand];
              return (
                <div key={`${hand}-limb`} className="arm-group">
                  <div
                    className={`arm upper ${hand}-arm`}
                    style={{
                      left: `${(shoulder.x / STAGE_WIDTH) * 100}%`,
                      top: `${(shoulder.y / STAGE_HEIGHT) * 100}%`,
                      height: `${(state.upperLength / STAGE_HEIGHT) * 100}%`,
                      transform: `translate(-50%, 0) rotate(${state.upperAngle}deg)`,
                    }}
                  >
                    <span className="joint shoulder" />
                  </div>
                  <div
                    className={`arm lower ${hand}-arm`}
                    style={{
                      left: `${(state.elbow.x / STAGE_WIDTH) * 100}%`,
                      top: `${(state.elbow.y / STAGE_HEIGHT) * 100}%`,
                      height: `${(state.lowerLength / STAGE_HEIGHT) * 100}%`,
                      transform: `translate(-50%, 0) rotate(${state.lowerAngle}deg)`,
                    }}
                  >
                    <span className="joint elbow" />
                    <span className="palm" />
                  </div>
                </div>
              );
            })}
          </div>
          {activeBalls.map((ball) => (
            <div
              key={`${ball.id}-${ball.ballId}`}
              className="ball"
              style={{
                left: `${ball.xPercent}%`,
                top: `${ball.yPercent}%`,
                backgroundColor: ball.color,
              }}
            />
          ))}
        </div>
        <div className="stage-footer">
          <div>
            <p className="label">Status</p>
            <p>{isPlaying ? "Playing" : "Paused"}</p>
          </div>
          <div>
            <p className="label">Pattern</p>
            <p>{stats ?? "—"}</p>
          </div>
          <div>
            <p className="label">Beat length</p>
            <p>{Math.round(beatDuration)} ms</p>
          </div>
        </div>
      </section>

      {parsed.error && <p className="error">{parsed.error}</p>}
      {!parsed.data && !parsed.error && <p className="error">Enter a pattern.</p>}

      <section className="notes">
        <h2>How it works</h2>
        <ul>
          <li>Each digit is a throw height telling you how many beats later the ball is caught.</li>
          <li>Odd throws cross hands, even throws stay on the same side.</li>
          <li>The average of all numbers equals the number of balls in the air.</li>
        </ul>
      </section>
    </div>
  );
}

export default App;
