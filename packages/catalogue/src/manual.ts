import type { CatalogueEntry } from '@gt7/contracts';

export const BRAND_CENTRAL_FAMILY = 'Brand Central';

type Track = { name: string; circuitId: number | null };

type BrandExperience = {
  id?: string;
  name: string;
  track: Track;
  wikiPage: string | null;
  car: string;
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
    { name: CORNERING_INTERMEDIATE, track: TRACKS.suzuka, wikiPage: 'Suzuka Circuit', car: IONIQ_5 },
    { name: RACING_LINE_INTERMEDIATE, track: TRACKS.mountPanorama, wikiPage: 'Mount Panorama', car: IONIQ_5 },
    { name: CONSECUTIVE_CORNERS_INTERMEDIATE, track: TRACKS.nurburgringGp, wikiPage: 'Nürburgring GP', car: IONIQ_6 },
    { name: CORNERING_EXPERT, track: TRACKS.sugo, wikiPage: 'SUGO International Racing Course', car: IONIQ_6 },
    { name: FINAL_EXAM, track: TRACKS.alsaceVillageReverse, wikiPage: 'Alsace - Village', car: IONIQ_6 }
  ],
  Polestar: [
    { name: CORNERING_INTERMEDIATE, track: TRACKS.dragonTrailGardens, wikiPage: 'Dragon Trail - Gardens', car: POLESTAR_5 },
    { name: RACING_LINE_INTERMEDIATE, track: TRACKS.brandsHatch, wikiPage: 'Brands Hatch GP', car: POLESTAR_5 },
    { name: CONSECUTIVE_CORNERS_INTERMEDIATE, track: TRACKS.interlagos, wikiPage: 'Autódromo de Interlagos', car: POLESTAR_5 },
    { name: CORNERING_EXPERT, track: TRACKS.fuji, wikiPage: 'Fuji International Speedway', car: POLESTAR_5 },
    { name: FINAL_EXAM, track: TRACKS.deepForest, wikiPage: 'Deep Forest Raceway', car: POLESTAR_5 }
  ],
  Xiaomi: [
    { name: CORNERING_INTERMEDIATE, track: TRACKS.deepForest, wikiPage: 'Deep Forest Raceway', car: SU7 },
    { name: HIGH_SPEED_CORNERS, track: TRACKS.nordschleife, wikiPage: 'Nürburgring Nordschleife', car: SU7 },
    { name: 'Tricky Consecutive Corners', track: TRACKS.leMans, wikiPage: 'Circuit de la Sarthe', car: SU7 },
    { name: CORNERING_EXPERT, track: TRACKS.alsaceVillage, wikiPage: 'Alsace - Village', car: XIAOMI_VGT },
    { name: FINAL_EXAM, track: TRACKS.lagoMaggiore, wikiPage: 'Autodrome Lago Maggiore - Full Course', car: XIAOMI_VGT }
  ],
  Yangwang: [
    {
      id: 'brand-yangwang-racing-lines',
      name: RACING_LINE_INTERMEDIATE,
      track: TRACKS.sugo,
      wikiPage: 'SUGO International Racing Course',
      car: U9
    },
    { name: HIGH_SPEED_CORNERS, track: TRACKS.suzuka, wikiPage: 'Suzuka Circuit', car: U9 },
    { name: 'Urban Tracks', track: TRACKS.tokyoEast, wikiPage: 'Tokyo Expressway - East Clockwise', car: U9 },
    { name: CORNERING_EXPERT, track: TRACKS.trialMountain, wikiPage: null, car: U9 },
    { name: FINAL_EXAM, track: TRACKS.yasMarina, wikiPage: 'Yas Marina Circuit', car: U9 }
  ]
};

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
    targetMs: null,
    source: experience.wikiPage === null ? 'Game screen' : `Game screen and Gran Turismo Wiki: ${experience.wikiPage}`
  };
}

export const MANUAL_ENTRIES: CatalogueEntry[] = Object.entries(BRANDS).flatMap(([brand, experiences]) =>
  experiences.map((experience, index) => brandEntry(brand, experience, index))
);
