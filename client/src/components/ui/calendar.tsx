import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "relative h-9 w-9 text-center text-sm p-0 focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100"
        ),
        range_start: "rounded-l-md rounded-r-none",
        range_end: "rounded-r-md rounded-l-none",
        range_middle:
          "bg-accent text-accent-foreground rounded-none",
        selected:
          "bg-primary text-primary-foreground rounded-md",
        today: "bg-accent text-accent-foreground",
        outside:
          "text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation }) => {
          switch (orientation) {
            case "left":
              return <ChevronLeft className={cn("h-4 w-4", className)} />
            case "right":
              return <ChevronRight className={cn("h-4 w-4", className)} />
            case "up":
              return <ChevronUp className={cn("h-4 w-4", className)} />
            default:
              return <ChevronDown className={cn("h-4 w-4", className)} />
          }
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
