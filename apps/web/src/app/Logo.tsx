const LOGO_WIDTH = 600;
const LOGO_HEIGHT = 133;

export function Logo({ height }: { height: 26 | 32 | 96 }) {
  const width = Math.round((height * LOGO_WIDTH) / LOGO_HEIGHT);
  return (
    <span className="logo" role="img" aria-label="GT7 Tutor">
      <img className="logo-light" src="/brand/logo-light-600.png" alt="" width={width} height={height} />
      <img className="logo-dark" src="/brand/logo-dark-600.png" alt="" width={width} height={height} />
    </span>
  );
}
