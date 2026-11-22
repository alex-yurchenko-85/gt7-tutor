export type BandValue = { value: string; caption: string; tone: '' | 'yellow' };

type RaceBandProps = { title: string | null; facts: string; values: BandValue[]; className?: string };

export function RaceBand({ title, facts, values, className }: RaceBandProps) {
  return (
    <section className={className ? `race-band ${className}` : 'race-band'}>
      {title === null ? null : (
        <div className="race-band-car">
          <h2>{title}</h2>
          <p>{facts}</p>
        </div>
      )}
      <div className="race-band-values">
        {values.map(item => (
          <div key={item.caption} className={['race-band-value', item.tone].filter(Boolean).join(' ')}>
            <b>{item.value}</b>
            <span>{item.caption}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
