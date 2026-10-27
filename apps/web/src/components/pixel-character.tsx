export function PixelCharacter({
  index = 0,
  className = "",
}: {
  index?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={"pixel-character " + className}
      style={{ backgroundPositionX: index * 20 + "%" }}
    />
  );
}
