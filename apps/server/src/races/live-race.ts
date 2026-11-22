import type { LiveRace, LiveRaceLap, LiveRacePhase, Sample } from '@gt7/contracts';
import { RaceWatch, bestLapOf, type CoreConfig, type RaceWatchEvent } from '@gt7/core';

export type TrackerOutcome = 'none' | 'finish' | 'ended';

const MIN_FUEL_USE_PER_LAP = 0.5;

type LapFuel = { start: number; pitOut: boolean };

export class LiveRaceTracker {
  private watch: RaceWatch;
  private lapLinePassed = false;
  private recorded: LiveRaceLap[] = [];
  private pitLaps = new Set<number>();
  private fuelUse: number[] = [];
  private lapFuel: LapFuel | null = null;
  private lastLapMs: number | null = null;
  private lapTimeMs = 0;
  private last: Sample | null = null;
  private fuel = 0;
  private carId: number | null = null;
  private gridPosition: number | null = null;
  private startPosition: number | null = null;

  constructor(private readonly config: CoreConfig) {
    this.watch = new RaceWatch(config);
  }

  get active(): boolean {
    return this.watch.state === 'grid' || this.watch.state === 'running';
  }

  get phase(): Exclude<LiveRacePhase, 'stopped'> {
    switch (this.watch.state) {
      case 'grid':
        return 'grid';
      case 'running':
        return this.lapLinePassed ? 'lap' : 'joined';
      case 'finished':
        return 'finished';
      case 'ended':
        return 'lap';
      default:
        return 'waiting';
    }
  }

  push(sample: Sample): TrackerOutcome {
    const fuelBefore = this.fuel;
    if (Number.isFinite(sample.fuel)) this.fuel = sample.fuel;
    this.last = sample;
    if (sample.playerSession) this.carId = sample.carId;
    const events = this.watch.push(sample);
    if (this.watch.state === 'grid' && sample.playerSession && sample.lap === 0) this.gridPosition = sample.racePosition;
    const lapEvent = events.find((event): event is Extract<RaceWatchEvent, { type: 'lap' }> => event.type === 'lap');
    this.lapTimeMs = lapEvent || events.some(event => event.type === 'start') ? 0 : Math.max(0, sample.gameTimerMs);
    for (const event of events) {
      if (event.type === 'grid' || event.type === 'join') this.beginRace();
      if (event.type === 'start') this.startLap(sample);
      if (event.type === 'lap') this.endLap(event, sample, fuelBefore);
      if (event.type === 'finish') return 'finish';
      if (event.type === 'ended') return this.lapLinePassed ? 'ended' : this.restart();
    }
    return 'none';
  }

  live(carName: (carId: number) => string | null): LiveRace {
    const best = bestLapOf(this.recorded, lap => this.pitLaps.has(lap.number));
    const meanUse = this.fuelUse.length === 0 ? null : this.fuelUse.reduce((sum, use) => sum + use, 0) / this.fuelUse.length;
    const sample = this.last;
    return {
      phase: this.phase,
      unsupported: this.watch.unsupported,
      lap: this.watch.lap,
      lapsInRace: this.watch.lapsInRace,
      firstRecordedLap: this.watch.firstRecordedLap,
      position: sample?.racePosition ?? 0,
      startPosition: this.startPosition,
      cars: sample?.carsInRace ?? 0,
      lapTimeMs: this.lapTimeMs,
      lastLapMs: this.lastLapMs,
      bestLap: best?.number ?? null,
      bestLapMs: best?.timeMs ?? null,
      laps: this.recorded.map(lap => ({ ...lap })),
      fuel: this.fuel,
      fuelLapsLeft: meanUse === null || meanUse < MIN_FUEL_USE_PER_LAP ? null : this.fuel / meanUse,
      x: sample?.position.x ?? 0,
      z: sample?.position.z ?? 0,
      carName: this.carId === null ? null : carName(this.carId),
      savedRaceId: null
    };
  }

  private beginRace(): void {
    this.lapLinePassed = false;
    this.lapFuel = null;
    this.gridPosition = null;
    this.startPosition = null;
  }

  private startLap(sample: Sample): void {
    this.startPosition = this.gridPosition ?? sample.racePosition;
    this.lapLinePassed = true;
    this.lapFuel = { start: this.fuel, pitOut: sample.loading };
  }

  private endLap(event: Extract<RaceWatchEvent, { type: 'lap' }>, sample: Sample, fuelBefore: number): void {
    this.lastLapMs = event.lastLapMs;
    const pitAfter = sample.loading;
    const firstLap = this.watch.firstRecordedLap;
    if (this.startPosition === null && firstLap !== null && this.watch.lap === firstLap) this.startPosition = sample.racePosition;
    if (firstLap !== null && event.lap >= firstLap) {
      this.recorded.push({ number: event.lap, timeMs: event.lastLapMs, pitAfter });
      const lapFuel = this.lapFuel;
      if (pitAfter || lapFuel?.pitOut) this.pitLaps.add(event.lap);
      if (lapFuel && !lapFuel.pitOut && !pitAfter) this.fuelUse.push(lapFuel.start - fuelBefore);
    }
    this.lapLinePassed = true;
    this.lapFuel = { start: this.fuel, pitOut: pitAfter };
  }

  private restart(): TrackerOutcome {
    this.watch = new RaceWatch(this.config);
    this.lapLinePassed = false;
    this.recorded = [];
    this.pitLaps = new Set();
    this.fuelUse = [];
    this.lapFuel = null;
    this.lastLapMs = null;
    this.lapTimeMs = 0;
    this.gridPosition = null;
    this.startPosition = null;
    return 'none';
  }
}
