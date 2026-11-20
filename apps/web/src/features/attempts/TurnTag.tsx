export function TurnTag({ turn, muted = false }: { turn: number | null; muted?: boolean }) {
  if (turn === null) return null;
  return (
    <>
      <span className={muted ? 'tag n turn-tag' : 'tag y turn-tag'}>T{turn}</span>{' '}
    </>
  );
}
