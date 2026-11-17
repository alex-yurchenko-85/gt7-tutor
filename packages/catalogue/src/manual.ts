import type { CatalogueEntry, MedalTargetTimes } from '@gt7/contracts';

export const BRAND_CENTRAL_FAMILY = 'Brand Central';

type Track = { name: string; circuitId: number | null };

type BrandExperience = {
  id?: string;
  name: string;
  track: Track;
  wikiPage: string | null;
  car: string;
  medalsMs: [gold: number, silver: number, bronze: number] | null;
};

const TRACKS = {
  alsaceVillage: { name: 'Alsace - Village', circuitId: 358 },
  alsaceVillageReverse: { name: 'Alsace - Village Reverse', circuitId: 439 },
  brandsHatch: { name: 'Brands Hatch Grand Prix Circuit', circuitId: 119 },
  deepForest: { name: 'Deep Forest Raceway', circuitId: 51 },
  dragonTrailGardens: { name: 'Dragon Trail - Gardens', circuitId: 847 },
  fuji: { name: 'Fuji International Speedway', circuitId: 16 },
  interlagos: { name: 'Autódromo de Interlagos', circuitId: 152 },
  lagoMaggiore: { name: 'Autodrome Lago Maggiore - Full Course', circuitId: 365 },
  leMans: { name: '24 Heures du Mans race track', circuitId: 454 },
  mountPanorama: { name: 'Mount Panorama Motor Racing Circuit', circuitId: 116 },
  nordschleife: { name: 'Nürburgring Nordschleife', circuitId: 95 },
  nurburgringGp: { name: 'Nürburgring GP', circuitId: 349 },
  sugo: { name: 'SUGO International Racing Course', circuitId: null },
  suzuka: { name: 'Suzuka Circuit', circuitId: 10 },
  tokyoEast: { name: 'Tokyo Expressway - East Clockwise', circuitId: 361 },
  trialMountain: { name: 'Trial Mountain Circuit', circuitId: 1024 },
  yasMarina: { name: 'Yas Marina Circuit', circuitId: 2003 }
} satisfies Record<string, Track>;

const IONIQ_5 = "Hyundai IONIQ 5 N '24";
const IONIQ_6 = "Hyundai IONIQ 6N '25";
const POLESTAR_5 = 'Polestar Polestar 5 Performance';
const SU7 = "Xiaomi SU7 Ultra '25";
const XIAOMI_VGT = 'Xiaomi Xiaomi VGT';
const U9 = "Yangwang U9 '24";

const CORNERING_INTERMEDIATE = 'Cornering: Intermediate';
const RACING_LINE_INTERMEDIATE = 'Racing Line: Intermediate';
const CONSECUTIVE_CORNERS_INTERMEDIATE = 'Consecutive Corners: Intermediate';
const HIGH_SPEED_CORNERS = 'High Speed Corners';
const CORNERING_EXPERT = 'Cornering: Expert';
const FINAL_EXAM = 'Final Exam';

const BRANDS: Record<string, BrandExperience[]> = {
  Hyundai: [
    { name: CORNERING_INTERMEDIATE, track: TRACKS.suzuka, wikiPage: 'Suzuka Circuit', car: IONIQ_5, medalsMs: [18400, 18900, 20400] },
    { name: RACING_LINE_INTERMEDIATE, track: TRACKS.mountPanorama, wikiPage: 'Mount Panorama', car: IONIQ_5, medalsMs: [42000, 43400, 46700] },
    { name: CONSECUTIVE_CORNERS_INTERMEDIATE, track: TRACKS.nurburgringGp, wikiPage: 'Nürburgring GP', car: IONIQ_6, medalsMs: [46200, 47500, 51100] },
    { name: CORNERING_EXPERT, track: TRACKS.sugo, wikiPage: 'SUGO International Racing Course', car: IONIQ_6, medalsMs: [33400, 34400, 37000] },
    { name: FINAL_EXAM, track: TRACKS.alsaceVillageReverse, wikiPage: 'Alsace - Village', car: IONIQ_6, medalsMs: null }
  ],
  Polestar: [
    { name: CORNERING_INTERMEDIATE, track: TRACKS.dragonTrailGardens, wikiPage: 'Dragon Trail - Gardens', car: POLESTAR_5, medalsMs: [15300, 15800, 17200] },
    { name: RACING_LINE_INTERMEDIATE, track: TRACKS.brandsHatch, wikiPage: 'Brands Hatch GP', car: POLESTAR_5, medalsMs: [38000, 39000, 42300] },
    { name: CONSECUTIVE_CORNERS_INTERMEDIATE, track: TRACKS.interlagos, wikiPage: 'Autódromo de Interlagos', car: POLESTAR_5, medalsMs: [33700, 34800, 38000] },
    { name: CORNERING_EXPERT, track: TRACKS.fuji, wikiPage: 'Fuji International Speedway', car: POLESTAR_5, medalsMs: [33700, 34700, 37300] },
    { name: FINAL_EXAM, track: TRACKS.deepForest, wikiPage: 'Deep Forest Raceway', car: POLESTAR_5, medalsMs: null }
  ],
  Xiaomi: [
    { name: CORNERING_INTERMEDIATE, track: TRACKS.deepForest, wikiPage: 'Deep Forest Raceway', car: SU7, medalsMs: [18700, 19300, 21000] },
    { name: HIGH_SPEED_CORNERS, track: TRACKS.nordschleife, wikiPage: 'Nürburgring Nordschleife', car: SU7, medalsMs: [25500, 26300, 28000] },
    { name: 'Tricky Consecutive Corners', track: TRACKS.leMans, wikiPage: 'Circuit de la Sarthe', car: SU7, medalsMs: [32800, 34200, 37000] },
    { name: CORNERING_EXPERT, track: TRACKS.alsaceVillage, wikiPage: 'Alsace - Village', car: XIAOMI_VGT, medalsMs: [35600, 36600, 39700] },
    { name: FINAL_EXAM, track: TRACKS.lagoMaggiore, wikiPage: 'Autodrome Lago Maggiore - Full Course', car: XIAOMI_VGT, medalsMs: null }
  ],
  Yangwang: [
    {
      id: 'brand-yangwang-racing-lines',
      name: RACING_LINE_INTERMEDIATE,
      track: TRACKS.sugo,
      wikiPage: 'SUGO International Racing Course',
      car: U9,
      medalsMs: [23500, 24200, 26000]
    },
    { name: HIGH_SPEED_CORNERS, track: TRACKS.suzuka, wikiPage: 'Suzuka Circuit', car: U9, medalsMs: [28000, 29300, 31800] },
    { name: 'Urban Tracks', track: TRACKS.tokyoEast, wikiPage: 'Tokyo Expressway - East Clockwise', car: U9, medalsMs: [23900, 24600, 26800] },
    { name: CORNERING_EXPERT, track: TRACKS.trialMountain, wikiPage: null, car: U9, medalsMs: [40000, 41300, 44400] },
    { name: FINAL_EXAM, track: TRACKS.yasMarina, wikiPage: 'Yas Marina Circuit', car: U9, medalsMs: null }
  ]
};

function medalTargets(medalsMs: BrandExperience['medalsMs']): MedalTargetTimes | null {
  if (medalsMs === null) return null;
  const [goldMs, silverMs, bronzeMs] = medalsMs;
  return { bronzeMs, silverMs, goldMs };
}

function brandEntry(brand: string, experience: BrandExperience, index: number): CatalogueEntry {
  const number = index + 1;
  return {
    id: experience.id ?? `brand-${brand.toLowerCase()}-exp-${number}`,
    family: BRAND_CENTRAL_FAMILY,
    collection: brand,
    code: `EXP-${number}`,
    name: experience.name,
    track: experience.track.name,
    circuitId: experience.track.circuitId,
    car: experience.car,
    targets: medalTargets(experience.medalsMs),
    sections: null,
    source: experience.wikiPage === null ? 'Game screen' : `Game screen and Gran Turismo Wiki: ${experience.wikiPage}`
  };
}

export const MANUAL_ENTRIES: CatalogueEntry[] = Object.entries(BRANDS).flatMap(([brand, experiences]) =>
  experiences.map((experience, index) => brandEntry(brand, experience, index))
);
