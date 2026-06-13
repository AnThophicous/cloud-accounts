import { type ComponentPropsWithoutRef, type ElementType, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { BoxRightArrow } from "../ui/boxicon";

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

interface BentoCardProps extends ComponentPropsWithoutRef<"article"> {
  name: string;
  description: string;
  className?: string;
  Icon: ElementType;
  href?: string;
  cta?: string;
  background?: ReactNode;
}

export const BentoGrid = ({ children, className, ...props }: BentoGridProps) => {
  return (
    <div className={cn("grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3", className)} {...props}>
      {children}
    </div>
  );
};

export const BentoCard = ({
  name,
  description,
  className,
  Icon,
  href,
  cta = "Open",
  background,
  ...props
}: BentoCardProps) => {
  return (
    <article
      className={cn(
        "relative overflow-hidden border border-[var(--app-line)] bg-[var(--app-surface)] p-5 transition-colors duration-200 hover:bg-[var(--app-surface-strong)]",
        className,
      )}
      {...props}
    >
      {background ? <div className="pointer-events-none absolute inset-0">{background}</div> : null}
      <div className="relative z-10 flex h-full flex-col justify-between gap-8">
        <div className="space-y-4">
          <div className="flex h-11 w-11 items-center justify-center border border-[var(--app-line)] bg-[var(--app-surface-strong)] text-[var(--app-fg)]">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-display text-lg text-[var(--app-fg)]">{name}</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--app-fg-soft)]">{description}</p>
          </div>
        </div>

        {href ? (
          <a
            href={href}
            className="inline-flex items-center gap-2 text-sm text-[var(--app-fg)] transition-opacity hover:opacity-70"
          >
            {cta}
            <BoxRightArrow className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </article>
  );
};
