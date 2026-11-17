import { cn } from "@/lib/utils";

/**
 * A picto from the Postmelo identity kit, in its light and dark variants.
 * Both images are in the page and CSS shows the one matching the effective theme
 * (system or forced in Réglages, see .theme-light / .theme-dark in globals.css).
 */
export function BrandIcon({ slug, className, alt = "" }: { slug: string; className?: string; alt?: string }) {
  return (
    <span className={cn("relative inline-block size-7 shrink-0", className)} role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/${slug}/icon-light-128.png`} alt="" width={128} height={128} draggable={false} className="theme-light absolute inset-0 size-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/${slug}/icon-dark-128.png`} alt="" width={128} height={128} draggable={false} className="theme-dark absolute inset-0 size-full" />
    </span>
  );
}

/** TickUp's check, black on light and ivory on dark. */
export function Logo({ className }: { className?: string }) {
  return <BrandIcon slug="tickup" className={className} />;
}
