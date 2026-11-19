export type CoreConfig = {
  udp: { receivePort: number; heartbeatPort: number; heartbeatMs: number };
  rawQueueBytes: number;
  freshnessMs: number;
  silenceGapMs: number;
  liveStateMaxHz: number;
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
  position: { lookAheadMs: number; holdMs: number };
  acceleration: {
    maxOverspeedMps: number;
    maxLateralM: number;
    maxHeadingErrorDeg: number;
    maxBrake: number;
    stableHoldMs: number;
  };
  target: { roundDownKph: number; throttleLookAheadMs: number };
  voice: {
    hardBrakeLossKph: number;
    lightBrakeLossKph: number;
    fullThrottle: number;
    bigStopEntryKph: number;
    bigStopLossKph: number;
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
  incompatibleOverspeedKph: number;
  sideCuesEnabled: boolean;
  findings: {
    brakeM: number;
    slowCornerKph: number;
    throttleLateM: number;
    offLineM: number;
    offLineMs: number;
    eventWindowM: number;
    cornerExtensionM: number;
  };
  recurring: { minAttempts: number; minShare: number; placeWithinM: number };
  reviewGridM: number;
  demoRange: {
    positionToleranceM: number;
    speedToleranceMps: number;
    pedalTolerance: number;
    minRunSamples: number;
    minPieceSamples: number;
    maxGapSamples: number;
    cueWindowMs: number;
    minMovementM: number;
    confirmMaxLateralM: number;
    confirmMaxLateralP95M: number;
    confirmMaxSpeedRatio: number;
    confirmMaxMedianPedal: number;
  };
};

export const DEFAULT_SIDE_CUE_DISTANCE_M = 2;

export const DEFAULT_CONFIG: CoreConfig = {
  udp: { receivePort: 33740, heartbeatPort: 33739, heartbeatMs: 1000 },
  rawQueueBytes: 8 * 1024 * 1024,
  freshnessMs: 150,
  silenceGapMs: 1000,
  liveStateMaxHz: 15,
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
  position: { lookAheadMs: 2000, holdMs: 300 },
  acceleration: {
    maxOverspeedMps: 1,
    maxLateralM: 3,
    maxHeadingErrorDeg: 10,
    maxBrake: 0.05,
    stableHoldMs: 300
  },
  target: { roundDownKph: 5, throttleLookAheadMs: 2000 },
  voice: {
    hardBrakeLossKph: 60,
    lightBrakeLossKph: 25,
    fullThrottle: 0.95,
    bigStopEntryKph: 200,
    bigStopLossKph: 100,
    bigStopLeadMs: 2000
  },
  corners: {
    maxRadiusM: 150,
    turnInShare: 1 / 3,
    curvatureSpanM: 10,
    apexAfterThrottleM: 40,
    wideApexM: 2,
    tighterHoldMs: 300
  },
  guidanceResumeMs: 1000,
  guidanceAnnounceAfterMs: 2000,
  incompatibleOverspeedKph: 15,
  sideCuesEnabled: true,
  findings: {
    brakeM: 8,
    slowCornerKph: 8,
    throttleLateM: 10,
    offLineM: 1.5,
    offLineMs: 500,
    eventWindowM: 60,
    cornerExtensionM: 40
  },
  recurring: { minAttempts: 3, minShare: 0.5, placeWithinM: 20 },
  reviewGridM: 2,
  demoRange: {
    positionToleranceM: 0.05,
    speedToleranceMps: 0.1,
    pedalTolerance: 0.02,
    minRunSamples: 60,
    minPieceSamples: 10,
    maxGapSamples: 2,
    cueWindowMs: 5000,
    minMovementM: 10,
    confirmMaxLateralM: 0.5,
    confirmMaxLateralP95M: 0.2,
    confirmMaxSpeedRatio: 0.01,
    confirmMaxMedianPedal: 0.05
  }
};
