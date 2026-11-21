import { Inject, Injectable } from '@nestjs/common';
import type { Circuit, Sample } from '@gt7/contracts';
import { DEFAULT_CONFIG, trackCandidates, type RaceAnalysis } from '@gt7/core';
import type { Knex } from 'knex';
import type { CaptureRow, RaceRow } from '../ownership/owned.js';
import { KNEX } from '../storage/knex.provider.js';

const TRACK_CANDIDATES_KEPT = 5;

export function trackCandidateNames(analysis: RaceAnalysis, circuits: Circuit[]): string[] {
  if (analysis.lapLengthM === null) return [];
  const known = circuits.flatMap(circuit => (circuit.lengthM === null ? [] : [{ name: circuit.name, lengthM: circuit.lengthM }]));
  return trackCandidates(analysis.lapLengthM, known, DEFAULT_CONFIG)
    .slice(0, TRACK_CANDIDATES_KEPT)
    .map(circuit => circuit.name);
}

export type SaveOptions = { trx?: Knex.Transaction; startedAt?: Date };

@Injectable()
export class RaceStore {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async save(userId: string, captureId: string, analysis: RaceAnalysis, candidates: string[], samples: Sample[], options: SaveOptions = {}): Promise<string> {
    const placeOf = (rawIndex: number) => samples.find(sample => sample.rawIndex === rawIndex)!.position;
    return (options.trx ?? this.db).transaction(async trx => {
      const capture = await trx<CaptureRow>('captures').where({ id: captureId, user_id: userId }).first();
      if (!capture) throw new Error(`Capture ${captureId} not found`);
      const [race] = await trx<RaceRow>('races')
        .insert({
          user_id: userId,
          capture_id: captureId,
          first_raw_index: analysis.range.first,
          last_raw_index: analysis.range.last,
          track_name: candidates.length === 1 ? candidates[0]! : null,
          track_candidates: JSON.stringify(candidates) as unknown as string[],
          car_id: analysis.carId,
          first_lap: analysis.firstLap,
          laps_in_race: analysis.lapsInRace,
          cars: analysis.carsInRace,
          start_position: analysis.startPosition,
          finish_position: analysis.finishPosition,
          race_ms: analysis.raceMs,
          best_lap: analysis.bestLap,
          best_lap_ms: analysis.bestLapMs,
          reference_lap: analysis.referenceLap,
          lap_length_m: analysis.lapLengthM,
          complete: analysis.complete,
          position_steps: JSON.stringify(analysis.position) as unknown as RaceRow['position_steps'],
          fuel_points: JSON.stringify(analysis.fuel) as unknown as RaceRow['fuel_points'],
          recurring: JSON.stringify(analysis.recurring) as unknown as RaceRow['recurring'],
          started_at: options.startedAt ?? new Date(capture.started_at.getTime() + Math.round(samples.find(sample => sample.rawIndex >= analysis.range.first)!.receivedMonoMs))
        })
        .returning('id');
      const raceId = race!.id;
      await trx('race_laps').insert(
        analysis.laps.map(lap => ({
          race_id: raceId,
          number: lap.number,
          first_raw_index: lap.range.first,
          last_raw_index: lap.range.last,
          time_ms: lap.timeMs,
          position_start: lap.positionStart,
          position_end: lap.positionEnd,
          top_speed_mps: lap.topSpeedMps,
          fuel_start: lap.fuelStart,
          fuel_end: lap.fuelEnd,
          pit_in: lap.pitIn,
          pit_out: lap.pitOut
        }))
      );
      const events = [
        ...analysis.pitStops.map(stop => ({
          race_id: raceId,
          kind: 'pit-stop',
          lap: stop.afterLap,
          s_m: null,
          x: placeOf(stop.stopRawIndex).x,
          z: placeOf(stop.stopRawIndex).z,
          wheels: null,
          duration_ms: stop.durationMs,
          speed_in_mps: null,
          speed_min_mps: null,
          fuel_before: stop.fuelBefore,
          fuel_after: stop.fuelAfter,
          first_raw_index: stop.stopRawIndex,
          last_raw_index: stop.exitRawIndex
        })),
        ...analysis.offTrack.map(moment => ({
          race_id: raceId,
          kind: 'off-track',
          lap: moment.lap,
          s_m: moment.sM,
          x: moment.x,
          z: moment.z,
          wheels: moment.wheels,
          duration_ms: moment.durationMs,
          speed_in_mps: moment.speedInMps,
          speed_min_mps: moment.speedMinMps,
          fuel_before: null,
          fuel_after: null,
          first_raw_index: moment.rawIndex,
          last_raw_index: moment.rawIndex
        }))
      ];
      if (events.length > 0) await trx('race_events').insert(events);
      return raceId;
    });
  }
}
