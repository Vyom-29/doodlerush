interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className={`brand-mark${compact ? " brand-mark--compact" : ""}`}>
      <span className="brand-spark" aria-hidden="true">
        ✦
      </span>
      <span className="brand-word">
        Doodle<span>Rush</span>
      </span>
    </span>
  );
}
