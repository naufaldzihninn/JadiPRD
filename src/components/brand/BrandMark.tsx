import Image from "next/image";

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/icon.png"
      alt="JadiPRD"
      width={size}
      height={size}
      className="shrink-0 rounded-lg"
      priority={size >= 40}
    />
  );
}
