import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[14px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-line-strong)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-bg)] hover:opacity-90",
        outline: "border border-[var(--app-line)] bg-[var(--app-surface)] text-[var(--app-fg)] hover:bg-[var(--app-surface-strong)]",
        ghost: "border border-transparent bg-transparent text-[var(--app-fg-soft)] hover:border-[var(--app-line)] hover:bg-[var(--app-surface-strong)] hover:text-[var(--app-fg)]",
        subtle: "border border-[var(--app-line)] bg-[var(--app-surface-strong)] text-[var(--app-fg)] hover:border-[var(--app-line-strong)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-5",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

Button.displayName = "Button";

export { Button, buttonVariants };
