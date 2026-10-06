interface AvatarBadgeProps {
  emoji: string;
  name: string;
  size?: "small" | "medium" | "large";
}

export function AvatarBadge({ emoji, name, size = "medium" }: AvatarBadgeProps) {
  return (
    <span className={`avatar-badge avatar-badge--${size}`} role="img" aria-label={`${name} avatar`}>
      {emoji}
    </span>
  );
}
