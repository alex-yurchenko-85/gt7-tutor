import { existsSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { readRaw } from '@gt7/capture';
import type {
  DeleteRacesResult,
  RaceCompare,
  RaceCompareQuery,
  RaceDetail,
  RaceLap,
  RaceDistances,
  RaceGoldenLap,
  RaceLapsSpeed,
  RaceOffTrack,
  RaceOffTrackView,
  RacePitStop,
  RaceRecurringPlace,
  RaceSummary,
  RenameRaceRequest,
  Sample
} from '@gt7/contracts';
import { DEFAULT_CONFIG, NOMINAL_PACKET_MS, analyseRace, isClosedLap, compareLaps, goldenLap, lapsSpeed, offTrackView, raceDistances, type RaceAnalysis } from '@gt7/core';
import type { Knex } from 'knex';
import { reviewBody } from '../attempts/review-shapes.js';
import { CaptureService } from '../captures/capture.service.js';
import { SampleCache } from '../captures/sample-cache.js';
import { dropOldest } from '../drop-oldest.js';
import { httpError } from '../http-errors.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { ownedRace, type CaptureRow, type RaceRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';
import { RaceRecorder } from './race-recorder.service.js';

type LapRow = {
  race_id: string;
  number: number;
  time_ms: number;
  position_start: number;
  position_end: number;
  top_speed_mps: number;
  fuel_start: number;
  fuel_end: number;
  pit_in: boolean;
  pit_out: boolean;
  last_raw_index: number;
};

type EventRow = {
  race_id: string;
  kind: 'off-track' | 'pit-stop';
  lap: number;
  s_m: number | null;
  x: number;
  z: number;
  wheels: number | null;
  duration_ms: number;
  speed_in_mps: number | null;
  speed_min_mps: number | null;
  fuel_before: number | null;
  fuel_after: number | null;
  first_raw_index: number;
};

type Counts = { laps: number; pitStops: number; offTrack: number };

type RaceSamples = { samples: Sample[]; analysis: RaceAnalysis };

const RACE_VIEW_LIMIT = 16;

const RACE_ANALYSIS_LIMIT = 2;

async function firstRawIndex(path: string): Promise<number | null> {
  if (!existsSync(path)) return null;
  try {
    for await (const row of readRaw(path)) return row.rawIndex;
  } catch {
    return null;
  }
  return null;
}

function rawMissing() {
  return httpError(409, 'raw-missing');
}

function noMatch() {
  return httpError(409, 'no-match');
}

function pitStop(row: EventRow, laps: LapRow[]): RacePitStop {
  const index = laps.findIndex(item => item.number === row.lap);
  const inLapEndMs = laps.slice(0, index + 1).reduce((total, item) => total + item.time_ms, 0);
  const inLap = laps[index];
  const fromMs = inLap ? inLapEndMs - (inLap.last_raw_index - row.first_raw_index) * NOMINAL_PACKET_MS : inLapEndMs;
  return { afterLap: row.lap, durationMs: row.duration_ms, fuelBefore: row.fuel_before!, fuelAfter: row.fuel_after!, fromMs, toMs: fromMs + row.duration_ms };
}

function offTrack(row: EventRow): RaceOffTrack {
  return {
    lap: row.lap,
    sM: row.s_m,
    x: row.x,
    z: row.z,
    wheels: row.wheels as RaceOffTrack['wheels'],
    durationMs: row.duration_ms,
    speedInMps: row.speed_in_mps!,
    speedMinMps: row.speed_min_mps!
  };
}

function lap(row: LapRow, moments: RaceOffTrack[]): RaceLap {
  const own = moments.filter(moment => moment.lap === row.number);
  return {
    number: row.number,
    timeMs: row.time_ms,
    positionStart: row.position_start,
    positionEnd: row.position_end,
    topSpeedMps: row.top_speed_mps,
    fuelStart: row.fuel_start,
    fuelEnd: row.fuel_end,
    pitIn: row.pit_in,
    pitOut: row.pit_out,
    closed: isClosedLap({ number: row.number, pitIn: row.pit_in, pitOut: row.pit_out }),
    offAll: own.filter(moment => moment.wheels === 4).length,
    offPart: own.filter(moment => moment.wheels < 4).length
  };
}

@Injectable()
export class RacesService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly captures: CaptureService,
    private readonly catalogue: CatalogueService,
    private readonly recorder: RaceRecorder,
    private readonly samples: SampleCache
  ) {}

  private readonly views = new Map<string, unknown>();
  private readonly analyses = new Map<string, Promise<RaceSamples>>();

  async list(userId: string): Promise<RaceSummary[]> {
    const rows = await this.db<RaceRow>('races').where({ user_id: userId }).orderBy([{ column: 'started_at', order: 'desc' }, { column: 'created_at', order: 'desc' }]);
    return this.summaries(rows);
  }

  async get(userId: string, id: string): Promise<RaceDetail> {
    const row = await ownedRace(this.db, userId, id);
    const [[summary], laps, events] = await Promise.all([
      this.summaries([row]),
      this.db<LapRow>('race_laps').where({ race_id: id }).orderBy('number'),
      this.db<EventRow>('race_events').where({ race_id: id }).orderBy(['lap', 'first_raw_index'])
    ]);
    const moments = events.filter(event => event.kind === 'off-track').map(offTrack);
    return {
      ...summary!,
      referenceLap: row.reference_lap,
      lapLengthM: row.lap_length_m,
      laps: laps.map(item => lap(item, moments)),
      pitStopList: events.filter(event => event.kind === 'pit-stop').map(event => pitStop(event, laps)),
      offTrackList: moments,
      recurring: row.recurring as RaceRecurringPlace[],
      position: row.position_steps,
      fuel: row.fuel_points
    };
  }

  async rename(userId: string, id: string, body: RenameRaceRequest): Promise<RaceSummary> {
    await ownedRace(this.db, userId, id);
    const [row] = await this.db<RaceRow>('races').where({ id }).update({ track_name: body.trackName }).returning('*');
    const [summary] = await this.summaries([row!]);
    return summary!;
  }

  async delete(userId: string, ids: string[]): Promise<DeleteRacesResult> {
    const unique = [...new Set(ids)];
    const deleted = await this.db.transaction(async (trx): Promise<number> => {
      const owned = await trx('races').whereIn('id', unique).where({ user_id: userId }).pluck<string[]>('id');
      if (owned.length !== unique.length) throw httpError(404, 'race-not-found');
      return await trx('races').whereIn('id', unique).del();
    });
    this.recorder.forgetRaces(userId, unique);
    for (const key of [...this.views.keys()]) if (unique.some(id => key.startsWith(`${id}:`))) this.views.delete(key);
    for (const id of unique) this.analyses.delete(id);
    return { deleted };
  }

  async compare(userId: string, id: string, query: RaceCompareQuery): Promise<RaceCompare> {
    const race = await ownedRace(this.db, userId, id);
    const laps = await this.db('race_laps').where({ race_id: id }).select<{ number: number; time_ms: number }[]>('number', 'time_ms');
    const known = new Set(laps.map(lap => lap.number));
    if (!known.has(query.lap)) throw httpError(400, 'unknown-lap', { lap: query.lap });
    if (query.with !== undefined && (!known.has(query.with) || query.with === query.lap)) throw httpError(400, 'same-lap');
    const withLap = query.with ?? this.defaultWith(race, laps, query.lap);
    const lap = query.lap;
    return this.view(race, `compare:${lap}:${withLap}`, ({ samples, analysis }) => {
      const result = compareLaps(samples, analysis, lap, withLap, DEFAULT_CONFIG);
      if (result === null) return null;
      return { lap, withLap, lapMs: result.lapMs, withMs: result.withMs, ...reviewBody(result.review, result.findings), turnLosses: result.turnLosses };
    });
  }

  async speed(userId: string, id: string): Promise<RaceLapsSpeed> {
    const race = await ownedRace(this.db, userId, id);
    return this.view(race, 'speed', ({ samples, analysis }) => lapsSpeed(samples, analysis, DEFAULT_CONFIG));
  }

  async distances(userId: string, id: string): Promise<RaceDistances> {
    const race = await ownedRace(this.db, userId, id);
    return this.view(race, 'distances', ({ samples, analysis }) => ({ points: raceDistances(samples, analysis, DEFAULT_CONFIG) }));
  }

  async offTrack(userId: string, id: string): Promise<RaceOffTrackView> {
    const race = await ownedRace(this.db, userId, id);
    const view = await this.view(race, 'off-track', ({ samples, analysis }) => offTrackView(samples, analysis, DEFAULT_CONFIG));
    const events = await this.db<EventRow>('race_events').where({ race_id: id, kind: 'off-track' }).orderBy(['lap', 'first_raw_index']);
    return { ...view, moments: events.map(offTrack), recurring: race.recurring as RaceRecurringPlace[] };
  }

  async golden(userId: string, id: string): Promise<RaceGoldenLap> {
    const race = await ownedRace(this.db, userId, id);
    return this.view(race, 'golden', ({ samples, analysis }) => {
      const view = offTrackView(samples, analysis, DEFAULT_CONFIG);
      const line = view ? { gridM: view.gridM, x: view.x, z: view.z } : { gridM: DEFAULT_CONFIG.reviewGridM, x: [], z: [] };
      return { ...goldenLap(samples, analysis, DEFAULT_CONFIG), line };
    });
  }

  private defaultWith(race: RaceRow, laps: { number: number; time_ms: number }[], lap: number): number {
    if (race.reference_lap !== lap) return race.reference_lap;
    const others = laps.filter(other => other.number !== lap).sort((a, b) => a.time_ms - b.time_ms || a.number - b.number);
    if (others.length === 0) throw httpError(409, 'no-match');
    return others[0]!.number;
  }

  private async view<T>(race: RaceRow, key: string, build: (race: RaceSamples) => T | null): Promise<T> {
    const path = await this.rawPathOf(race);
    const viewKey = `${race.id}:${key}`;
    const cached = this.views.get(viewKey) as T | undefined;
    if (cached !== undefined) {
      this.views.delete(viewKey);
      this.views.set(viewKey, cached);
      return cached;
    }
    const result = build(await this.analysis(race, path));
    if (result === null) throw noMatch();
    this.views.set(viewKey, result);
    dropOldest(this.views, RACE_VIEW_LIMIT);
    return result;
  }

  private analysis(race: RaceRow, path: string): Promise<RaceSamples> {
    const cached = this.analyses.get(race.id);
    if (cached) return cached;
    const loading = this.samples.read(race.capture_id, path, { first: race.first_raw_index, last: race.last_raw_index }).then(
      samples => {
        const analysis = analyseRace(samples, DEFAULT_CONFIG);
        if (analysis === null) throw noMatch();
        return { samples, analysis };
      },
      () => {
        throw rawMissing();
      }
    );
    this.analyses.set(race.id, loading);
    dropOldest(this.analyses, RACE_ANALYSIS_LIMIT);
    loading.catch(() => {
      if (this.analyses.get(race.id) === loading) this.analyses.delete(race.id);
    });
    return loading;
  }

  private async rawPathOf(race: RaceRow): Promise<string> {
    const capture = (await this.db<CaptureRow>('captures').where({ id: race.capture_id }).first())!;
    const path = this.captures.rawPath(capture);
    const first = await firstRawIndex(path);
    if (first === null || first > race.first_raw_index) throw rawMissing();
    return path;
  }

  private async summaries(rows: RaceRow[]): Promise<RaceSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map(row => row.id);
    const counts = new Map<string, Counts>(ids.map(id => [id, { laps: 0, pitStops: 0, offTrack: 0 }]));
    const [laps, events] = await Promise.all([
      this.db('race_laps').whereIn('race_id', ids).groupBy('race_id').select<{ race_id: string; count: number }[]>('race_id', this.db.raw('count(*)::int as count')),
      this.db('race_events')
        .whereIn('race_id', ids)
        .groupBy('race_id', 'kind')
        .select<{ race_id: string; kind: EventRow['kind']; count: number }[]>('race_id', 'kind', this.db.raw('count(*)::int as count'))
    ]);
    for (const row of laps) counts.get(row.race_id)!.laps = row.count;
    for (const row of events) counts.get(row.race_id)![row.kind === 'pit-stop' ? 'pitStops' : 'offTrack'] = row.count;
    return rows.map(row => {
      const count = counts.get(row.id)!;
      return {
        id: row.id,
        trackName: row.track_name,
        trackCandidates: row.track_candidates,
        carId: row.car_id,
        carName: this.catalogue.carName(row.car_id),
        firstLap: row.first_lap,
        lapsDone: count.laps,
        lapsInRace: row.laps_in_race,
        cars: row.cars,
        startPosition: row.start_position,
        finishPosition: row.finish_position,
        raceMs: row.race_ms,
        bestLap: row.best_lap,
        bestLapMs: row.best_lap_ms,
        pitStops: count.pitStops,
        offTrack: count.offTrack,
        complete: row.complete,
        startedAt: row.started_at.toISOString()
      };
    });
  }
}
