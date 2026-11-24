import { useState } from 'react';
import { t } from '../../app/i18n.ts';
import { Icon } from '../../app/icons.tsx';
import { Link, paths } from '../../app/router.tsx';
import { isMine, isSearching, OWN, type CatalogueGroup, type GroupRow, type PageFilters } from './exercise-page.ts';
import { OwnExercise } from './OwnExercise.tsx';
import { entryRowName, ExerciseRow, familyName, NameCell, ownRowName, PlaceCell, StateCell, targetText } from './page-rows.tsx';

type RecordProps = { busy: boolean; onRecord(entryId: string): void };

type CatalogueGroupsProps = RecordProps & {
  groups: CatalogueGroup[];
  filters: PageFilters;
  currentId: string | null;
  wide: boolean;
};

function kindText(group: CatalogueGroup): string {
  if (group.kind === 'tests') return t('exercises.home.group-tests', { count: group.total });
  if (group.kind === 'sectors') return t('exercises.home.group-sectors', { count: group.total });
  return t('exercises.home.group-exercises', { count: group.total });
}

function groupSummary(group: CatalogueGroup, wide: boolean): string {
  if (!wide) {
    if (group.atTarget > 0) return t('exercises.home.group-at-target-phone', { at: group.atTarget, total: group.total });
    if (group.inProgress > 0) return t('exercises.home.group-in-progress', { count: group.inProgress });
    return kindText(group);
  }
  return [
    kindText(group),
    group.atTarget > 0 ? t('exercises.home.group-at-target', { count: group.atTarget }) : null,
    group.inProgress > 0 ? t('exercises.home.group-in-progress', { count: group.inProgress }) : null
  ]
    .filter(Boolean)
    .join(' · ');
}

function RecordAction({ row, busy, onRecord }: RecordProps & { row: GroupRow }) {
  if (row.exercise) {
    return (
      <Link to={paths.record(row.exercise.id)} className="btn record-action">
        {t('exercises.home.record')}
      </Link>
    );
  }
  return (
    <button type="button" className="btn record-action" disabled={busy} onClick={() => onRecord(row.entry!.id)}>
      {t('exercises.home.record')}
    </button>
  );
}

type RowProps = RecordProps & { row: GroupRow; wide: boolean; open: boolean; onToggle(): void };

function NewRow({ row, wide, open, onToggle, busy, onRecord }: RowProps) {
  const entry = row.entry!;
  const targetMs = entry.targetMs;
  if (wide) {
    return (
      <div className="page-row">
        <NameCell name={entryRowName(entry)} />
        <PlaceCell entry={entry} />
        <StateCell exercise={null} targetMs={targetMs} wide />
        <span className="page-row-end">
          <RecordAction row={row} busy={busy} onRecord={onRecord} />
        </span>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="page-row page-row-toggle" onClick={onToggle}>
        <NameCell name={entryRowName(entry)} />
        {open ? <Icon name="chevron-up" size={20} /> : <StateCell exercise={null} targetMs={targetMs} wide={false} />}
      </button>
      {open ? (
        <div className="page-row-more">
          <p>
            {entry.track ?? t('exercises.home.no-track')}
            {entry.car ? (
              <>
                <br />
                <span className="sub">{entry.car}</span>
              </>
            ) : null}
            {targetMs !== null ? (
              <>
                <br />
                <span className="sub">{targetText(targetMs)}</span>
              </>
            ) : null}
          </p>
          <RecordAction row={row} busy={busy} onRecord={onRecord} />
        </div>
      ) : null}
    </>
  );
}

function rowKey(row: GroupRow): string {
  return row.entry?.id ?? row.exercise!.id;
}

function GroupRows(props: RecordProps & { rows: GroupRow[]; currentId: string | null; wide: boolean; openRow: string | null; onToggleRow(key: string): void }) {
  const { rows, currentId, wide, openRow, onToggleRow, busy, onRecord } = props;
  return (
    <ul className="group-rows">
      {rows.map(row => {
        const key = rowKey(row);
        const started = row.exercise !== null && isMine(row.exercise);
        const open = openRow === key;
        return (
          <li key={key} className={open ? 'catalogue-item open' : 'catalogue-item'} {...(row.entry ? { 'data-entry': row.entry.id } : {})}>
            {started ? (
              <ExerciseRow
                exercise={row.exercise!}
                entry={row.entry}
                name={row.entry ? entryRowName(row.entry) : ownRowName(row.exercise!)}
                current={row.exercise!.id === currentId}
                wide={wide}
              />
            ) : (
              <NewRow row={row} wide={wide} open={open} onToggle={() => onToggleRow(key)} busy={busy} onRecord={onRecord} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Opened = { filterKey: string; open: Record<string, boolean> };

export function CatalogueGroups({ groups, filters, currentId, wide, busy, onRecord }: CatalogueGroupsProps) {
  const filtering = isSearching(filters);
  const filterKey = filtering ? `${filters.q.trim()}\n${filters.track}` : '';
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [searchOpened, setSearchOpened] = useState<Opened>({ filterKey: '', open: {} });
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const searchOpen = searchOpened.filterKey === filterKey ? searchOpened.open : {};
  const isOpen = (key: string) => (filtering ? (searchOpen[key] ?? true) : (opened[key] ?? false));
  const toggle = (key: string) => {
    const next = !isOpen(key);
    if (filtering) setSearchOpened({ filterKey, open: { ...searchOpen, [key]: next } });
    else setOpened(current => ({ ...current, [key]: next }));
  };
  const toggleRow = (key: string) => setOpenRow(current => (current === key ? null : key));
  const rowProps = { currentId, wide, openRow, onToggleRow: toggleRow, busy, onRecord };
  return (
    <>
      {groups.map((group, index) => {
        const label = index === 0 || groups[index - 1]!.family !== group.family ? <p className="family-label">{familyName(group.family)}</p> : null;
        if (group.family === OWN) {
          return (
            <div key={group.key}>
              {label}
              <div className="catalogue-group own-group">
                {group.rows.length > 0 ? <GroupRows rows={group.rows} {...rowProps} /> : null}
                <button type="button" className="group-head own-head" aria-expanded={ownOpen} onClick={() => setOwnOpen(!ownOpen)}>
                  <b>{t('exercises.home.own-open')}</b>
                  <span className="sub">{wide ? t('exercises.home.own-open-text') : null}</span>
                  <Icon name={ownOpen ? 'chevron-up' : 'plus'} size={20} />
                </button>
                {ownOpen ? <OwnExercise /> : null}
              </div>
            </div>
          );
        }
        const open = isOpen(group.key);
        return (
          <div key={group.key}>
            {label}
            <div className="catalogue-group">
              <button
                type="button"
                className="group-head"
                aria-expanded={open}
                title={open ? t('exercises.home.close-group') : t('exercises.home.open-group')}
                onClick={() => toggle(group.key)}
              >
                <b>{group.title}</b>
                <span className="sub">{groupSummary(group, wide)}</span>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={20} />
              </button>
              {open ? <GroupRows rows={group.rows} {...rowProps} /> : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
