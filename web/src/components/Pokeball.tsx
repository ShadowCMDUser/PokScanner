import { useId } from "react";

type Props = {
  className?: string;
  spin?: boolean;
};

export function PokeballIcon({ className, spin }: Props) {
  const clip = `pokeball-${useId().replace(/:/g, "")}`;

  return (
    <svg className={`${className ?? ""}${spin ? " spin-ball" : ""}`} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="32" fill="#EE1515" />
        <rect y="32" width="64" height="32" fill="#FFFFFF" />
        <rect y="28" width="64" height="8" fill="#111111" />
      </g>
      <circle cx="32" cy="32" r="30" fill="none" stroke="#111111" strokeWidth="3.5" />
      <circle cx="32" cy="32" r="10" fill="#111111" />
      <circle cx="32" cy="32" r="6.2" fill="#FFFFFF" />
    </svg>
  );
}
