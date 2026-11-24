import { t } from '../../app/i18n.ts';
import { Icon } from '../../app/icons.tsx';
import { NO_PAGE_FILTERS, OWN, type PageFilters } from './exercise-page.ts';
import { familyName } from './page-rows.tsx';

type ExerciseFiltersProps = {
  filters: PageFilters;
  families: string[];
  tracks: string[];
  wide: boolean;
  onChange(change: Partial<PageFilters>): void;
};

function familyLabel(family: string): string {
  return family === NO_PAGE_FILTERS.family ? t('exercises.home.all') : familyName(family);
}

export function ExerciseFilters({ filters, families, tracks, wide, onChange }: ExerciseFiltersProps) {
  return (
    <div className="page-filters">
      <label className="search-field">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={filters.q}
          placeholder={wide ? t('exercises.home.search-hint') : t('exercises.home.search-hint-phone')}
          onChange={event => onChange({ q: event.target.value })}
        />
      </label>
      <div className="family-chips">
        {[NO_PAGE_FILTERS.family, ...families, OWN].map(family => (
          <button key={family} type="button" aria-pressed={filters.family === family} onClick={() => onChange({ family, track: '' })}>
            {familyLabel(family)}
          </button>
        ))}
      </div>
      <select className="input track-filter" value={filters.track} onChange={event => onChange({ track: event.target.value })}>
        <option value="">{t('exercises.home.all-tracks')}</option>
        {tracks.map(track => (
          <option key={track}>{track}</option>
        ))}
      </select>
    </div>
  );
}
