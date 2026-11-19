import { RECURRING_MIN_ATTEMPTS, WIDE_APEX_M } from '@gt7/contracts';
import { kph } from './units.ts';

export type CoreConfig = {
  freshnessMs: number;
  silenceGapMs: number;
  match: {
    lateralM: number;
    searchLateralM: number;
    heightM: number;
    headingDeg: number;
    headingMinSpeedMps: number;
    searchBackM: number;
    searchForwardMinM: number;
    searchForwardMarginM: number;
    progressWeight: number;
    sectionEndToleranceM: number;
  };
  discontinuityMarginM: number;
  events: {
    consecutiveSamples: number;
    brakeOn: number;
    liftFrom: number;
    liftTo: number;
    throttleOn: number;
    mergeWithinM: number;
    liftBrakeWindowMs: number;
    endMarginM: number;
  };
  cue: {
    leadReactionMs: number;
    ttlBaseMs: number;
    cooldownMs: number;
    priority: { brake: number; bigStop: number; easeOff: number; position: number; throttle: number; system: number };
  };
  position: { holdMs: number };
  acceleration: {
    maxOverspeedMps: number;
    maxLateralM: number;
    maxHeadingErrorDeg: number;
    maxBrake: number;
    stableHoldMs: number;
  };
  target: { roundDownKph: number; throttleLookAheadMs: number };
  voice: {
    hardBrakeLossMps: number;
    lightBrakeLossMps: number;
    fullThrottle: number;
    bigStopEntryMps: number;
    bigStopLossMps: number;
    bigStopLeadMs: number;
  };
  corners: {
    maxRadiusM: number;
    turnInShare: number;
    curvatureSpanM: number;
    apexAfterThrottleM: number;
    wideApexM: number;
    tighterHoldMs: number;
  };
  guidanceResumeMs: number;
  guidanceAnnounceAfterMs: number;
  incompatibleOverspeedMps: number;
  findings: {
    brakeM: number;
    slowCornerMps: number;
    throttleLateM: number;
    offLineM: number;
    offLineMs: number;
    eventWindowM: number;
    cornerExtensionM: number;
  };
  recurring: { minAttempts: number; minShare: number; placeWithinM: number };
  reviewGridM: number;
  reviewMaxBridgeM: number;
  gameTimer: { startMaxMs: number; stillPackets: number };
  brakeReaction: { onThreshold: number; windowMs: number };
  coach: { defaultPeriodMs: number; maxPeriodMs: number; accelerationWindowMs: number; minAccelerationSpanMs: number };
  demoRange: {
    positionToleranceM: number;
    speedToleranceMps: number;
    pedalTolerance: number;
    minRunSamples: number;
    minPieceSamples: number;
    maxGapSamples: number;
    minMovementM: number;
    confirmMaxLateralM: number;
    confirmMaxLateralP95M: number;
    confirmMaxSpeedRatio: number;
    confirmMaxMedianPedal: number;
    followSpeedRatio: number;
    followSpeedBaseMps: number;
  };
};

export const DEFAULT_SIDE_CUE_DISTANCE_M = 2;

export const DEFAULT_CONFIG: CoreConfig = {
  freshnessMs: 150,
  silenceGapMs: 1000,
  match: {
    lateralM: 8,
    searchLateralM: 8,
    heightM: 3,
    headingDeg: 45,
    headingMinSpeedMps: 2,
    searchBackM: 5,
    searchForwardMinM: 20,
    searchForwardMarginM: 10,
    progressWeight: 0.5,
    sectionEndToleranceM: 1
  },
  discontinuityMarginM: 20,
  events: {
    consecutiveSamples: 3,
    brakeOn: 0.1,
    liftFrom: 0.5,
    liftTo: 0.1,
    throttleOn: 0.5,
    mergeWithinM: 5,
    liftBrakeWindowMs: 1000,
    endMarginM: 20
  },
  cue: {
    leadReactionMs: 500,
    ttlBaseMs: 150,
    cooldownMs: 1500,
    priority: { brake: 100, bigStop: 95, easeOff: 90, position: 50, throttle: 20, system: 10 }
  },
  position: { holdMs: 300 },
  acceleration: {
    maxOverspeedMps: 1,
    maxLateralM: 3,
    maxHeadingErrorDeg: 10,
    maxBrake: 0.05,
    stableHoldMs: 300
  },
  target: { roundDownKph: 5, throttleLookAheadMs: 2000 },
  voice: {
    hardBrakeLossMps: kph(60),
    lightBrakeLossMps: kph(25),
    fullThrottle: 0.95,
    bigStopEntryMps: kph(200),
    bigStopLossMps: kph(100),
    bigStopLeadMs: 2000
  },
  corners: {
    maxRadiusM: 150,
    turnInShare: 1 / 3,
    curvatureSpanM: 10,
    apexAfterThrottleM: 40,
    wideApexM: WIDE_APEX_M,
    tighterHoldMs: 300
  },
  guidanceResumeMs: 1000,
  guidanceAnnounceAfterMs: 2000,
  incompatibleOverspeedMps: kph(15),
  findings: {
    brakeM: 8,
    slowCornerMps: kph(8),
    throttleLateM: 10,
    offLineM: 1.5,
    offLineMs: 500,
    eventWindowM: 60,
    cornerExtensionM: 40
  },
  recurring: { minAttempts: RECURRING_MIN_ATTEMPTS, minShare: 0.5, placeWithinM: 20 },
  reviewGridM: 2,
  reviewMaxBridgeM: 10,
  gameTimer: { startMaxMs: 50, stillPackets: 3 },
  brakeReaction: { onThreshold: 0.1, windowMs: 3000 },
  coach: { defaultPeriodMs: 1000 / 60, maxPeriodMs: 100, accelerationWindowMs: 300, minAccelerationSpanMs: 100 },
  demoRange: {
    positionToleranceM: 0.05,
    speedToleranceMps: 0.1,
    pedalTolerance: 0.02,
    minRunSamples: 60,
    minPieceSamples: 10,
    maxGapSamples: 2,
    minMovementM: 10,
    confirmMaxLateralM: 0.5,
    confirmMaxLateralP95M: 0.2,
    confirmMaxSpeedRatio: 0.01,
    confirmMaxMedianPedal: 0.05,
    followSpeedRatio: 0.05,
    followSpeedBaseMps: 0.5
  }
};
