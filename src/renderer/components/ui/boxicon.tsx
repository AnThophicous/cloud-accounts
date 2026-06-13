import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type BoxIconProps = HTMLAttributes<HTMLElement> & {
  name: string;
};

export function BoxIcon({ name, className, ...props }: BoxIconProps) {
  return <i aria-hidden="true" className={cn("bx", name, className)} {...props} />;
}

export const BoxPlus = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-plus-circle" {...props} />;
export const BoxCog = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-cog" {...props} />;
export const BoxLogOut = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-log-out" {...props} />;
export const BoxLeftArrow = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-left-arrow" {...props} />;
export const BoxRightArrow = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-right-arrow" {...props} />;
export const BoxChevronLeft = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-chevron-left" {...props} />;
export const BoxChevronRight = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-chevron-right" {...props} />;
export const BoxLaptop = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-laptop" {...props} />;
export const BoxCheckCircle = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-check-circle" {...props} />;
export const BoxTrash = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-trash" {...props} />;
export const BoxMoon = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-moon" {...props} />;
export const BoxSun = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-sun" {...props} />;
export const BoxStar = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-star" {...props} />;
export const BoxGroup = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-group" {...props} />;
export const BoxUser = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-user" {...props} />;
export const BoxShield = (props: Omit<BoxIconProps, "name">) => <BoxIcon name="bxs-shield-alt-2" {...props} />;
