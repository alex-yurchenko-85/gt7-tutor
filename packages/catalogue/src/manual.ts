import type { CatalogueEntry, MedalTargetTimes } from '@gt7/contracts';

export const BRAND_CENTRAL_FAMILY = 'Brand Central';

type BrandExperience = {
  brand: string;
  number: number;
  name: string;
  track: string;
  circuitId: number | null;
  wikiPage: string;
  car: string;
  targets: MedalTargetTimes;
};

function brandExperience(experience: BrandExperience): CatalogueEntry {
  return {
    id: `brand-${experience.brand.toLowerCase()}-exp-${experience.number}`,
    family: BRAND_CENTRAL_FAMILY,
    collection: experience.brand,
    code: `EXP-${experience.number}`,
    name: experience.name,
    track: experience.track,
    circuitId: experience.circuitId,
    car: experience.car,
    targets: experience.targets,
    sections: null,
    source: `Game screen and Gran Turismo Wiki: ${experience.wikiPage}`
  };
}

const HYUNDAI: BrandExperience[] = [
  {
    brand: 'Hyundai',
    number: 1,
    name: 'Cornering: Intermediate',
    track: 'Suzuka Circuit',
    circuitId: 10,
    wikiPage: 'Suzuka Circuit',
    car: "Hyundai IONIQ 5 N '24",
    targets: { bronzeMs: 20400, silverMs: 18900, goldMs: 18400 }
  },
  {
    brand: 'Hyundai',
    number: 2,
    name: 'Racing Line: Intermediate',
    track: 'Mount Panorama Motor Racing Circuit',
    circuitId: 116,
    wikiPage: 'Mount Panorama',
    car: "Hyundai IONIQ 5 N '24",
    targets: { bronzeMs: 46700, silverMs: 43400, goldMs: 42000 }
  },
  {
    brand: 'Hyundai',
    number: 3,
    name: 'Consecutive Corners: Intermediate',
    track: 'Nürburgring GP',
    circuitId: 349,
    wikiPage: 'Nürburgring GP',
    car: "Hyundai IONIQ 6N '25",
    targets: { bronzeMs: 51100, silverMs: 47500, goldMs: 46200 }
  },
  {
    brand: 'Hyundai',
    number: 4,
    name: 'Cornering: Expert',
    track: 'SUGO International Racing Course',
    circuitId: null,
    wikiPage: 'SUGO International Racing Course',
    car: "Hyundai IONIQ 6N '25",
    targets: { bronzeMs: 37000, silverMs: 34400, goldMs: 33400 }
  }
];

export const MANUAL_ENTRIES: CatalogueEntry[] = [
  ...HYUNDAI.map(brandExperience),
  {
    id: 'brand-yangwang-racing-lines',
    family: BRAND_CENTRAL_FAMILY,
    collection: 'Yangwang',
    code: null,
    name: 'Racing Lines',
    track: null,
    circuitId: null,
    car: "Yangwang U9 '24",
    targets: null,
    sections: null,
    source: 'Manual entry'
  }
];
