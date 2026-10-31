import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Trayek Angkot buttons: solid paint, thick edges, thumb-sized. Every size meets the 48px touch floor.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[12px] font-bold whitespace-nowrap transition-[background-color,transform,opacity] duration-150 ease-out outline-none select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // White paint with dark ink: the default action.
        default: "bg-paint text-ink hover:bg-white",
        sos: "bg-sos text-white hover:bg-[#c71f15]",
        outline: "border-2 border-paint/70 bg-transparent text-paint hover:bg-asphalt-3",
        secondary: "bg-asphalt-3 text-paint hover:bg-[#363b45]",
        ghost: "text-paint hover:bg-asphalt-3",
        link: "text-signal underline underline-offset-4",
      },
      size: {
        default: "min-h-12 px-4 text-[18px]",
        lg: "min-h-14 px-5 text-[18px]",
        xl: "min-h-16 px-6 text-[20px]",
        icon: "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
