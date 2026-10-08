import { cn } from "../../lib/utils"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("dshx:size-4 dshx:animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
