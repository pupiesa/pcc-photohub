"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/* ---------------- Logo ---------------- */
const Logo = (props: React.SVGAttributes<SVGElement>) => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 324 323"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="88.1023" y="144.792" width="151.802" height="36.5788" rx="18.2894" transform="rotate(-38.5799 88.1023 144.792)" />
    <rect x="85.3459" y="244.537" width="151.802" height="36.5788" rx="18.2894" transform="rotate(-38.5799 85.3459 244.537)" />
  </svg>
)

/* --------------- Hamburger --------------- */
const HamburgerIcon = ({ className, ...props }: React.SVGAttributes<SVGElement>) => (
  <svg
    className={cn("pointer-events-none", className)}
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M4 12L20 12" className="origin-center -translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-x-0 group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[315deg]" />
    <path d="M4 12H20" className="origin-center transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.8)] group-aria-expanded:rotate-45" />
    <path d="M4 12H20" className="origin-center translate-y-[7px] transition-all duration-300 ease-[cubic-bezier(.5,.85,.25,1.1)] group-aria-expanded:translate-y-0 group-aria-expanded:rotate-[135deg]" />
  </svg>
)

/* ---------------- Types ---------------- */
export interface Navbar03NavItem {
  href?: string
  label: string
  active?: boolean
  authOnly?: boolean
}

export interface Navbar03Props extends React.HTMLAttributes<HTMLElement> {
  logo?: React.ReactNode
  logoHref?: string
  navigationLinks?: Navbar03NavItem[]
}

/* --------- Real routes (no "#") --------- */
const defaultNavigationLinks: Navbar03NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/gallery", label: "Gallery" },
  { href: "/about", label: "About" },
]

/* --------- small helper to assign forwarded refs (no any) --------- */
function assignRef<T>(ref: React.ForwardedRef<T>, value: T) {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref && "current" in ref) {
    ;(ref as React.MutableRefObject<T>).current = value
  }
}

export const Navbar03 = React.forwardRef<HTMLElement, Navbar03Props>(
  (
    {
      className,
      logo = <Logo />,
      logoHref = "/",
      navigationLinks = defaultNavigationLinks,
      ...props
    },
    ref
  ) => {
    const pathname = usePathname()
    const [isMobile, setIsMobile] = React.useState(false)
    const [mobileOpen, setMobileOpen] = React.useState(false)
    const containerRef = React.useRef<HTMLElement | null>(null)

    React.useEffect(() => {
      const checkWidth = () => {
        if (containerRef.current) {
          setIsMobile(containerRef.current.offsetWidth < 768) // md breakpoint
        }
      }
      checkWidth()
      const ro = new ResizeObserver(checkWidth)
      if (containerRef.current) ro.observe(containerRef.current)
      return () => ro.disconnect()
    }, [])

    const combinedRef = React.useCallback(
      (node: HTMLElement | null) => {
        containerRef.current = node
        assignRef(ref, node as HTMLElement)
      },
      [ref]
    )

    const isActive = (href?: string) => {
      if (!href) return false
      if (href === "/") return pathname === "/"
      return pathname === href || pathname.startsWith(href + "/")
    }

    return (
      <header
        ref={combinedRef}
        className={cn(
          "sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          className
        )}
        {...props}
      >
        <div className="container mx-auto flex h-14 items-center justify-between gap-4 px-4">
          {/* Left */}
          <div className="flex items-center gap-2">
            {/* Mobile menu */}
            {isMobile && (
              <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
                <PopoverTrigger asChild>
                  <Button
                    className="group h-8 w-8 hover:bg-transparent hover:text-primary"
                    variant="ghost"
                    size="icon"
                    aria-label="Open menu"
                  >
                    <HamburgerIcon />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-56 p-1 bg-background/95 backdrop-blur">
                  <nav className="flex flex-col">
                    {navigationLinks
                      .filter((l) => !l.authOnly)
                      .map((link) => {
                        const active = isActive(link.href)
                        return (
                          <Button
                            key={link.href}
                            asChild
                            variant={active ? "secondary" : "ghost"}
                            className={cn("justify-start text-sm", active && "font-medium")}
                            onClick={() => setMobileOpen(false)}
                          >
                            <Link href={link.href || "#"}>{link.label}</Link>
                          </Button>
                        )
                      })}
                  </nav>
                </PopoverContent>
              </Popover>
            )}

            {/* Logo */}
            <Button asChild variant="link" className="px-0 text-primary hover:text-primary/80">
              <Link href={logoHref} className="flex items-center space-x-2">
                <span className="text-xl">{logo}</span>
                <span className="font-semibold text-lg sm:inline-block">Pcc-photohub</span>
              </Link>
            </Button>

            {/* Desktop nav */}
            {!isMobile && (
              <NavigationMenu className="flex">
                <NavigationMenuList className="gap-2">
                  {navigationLinks
                    .filter((l) => !l.authOnly)
                    .map((link) => {
                      const active = isActive(link.href)
                      return (
                        <NavigationMenuItem key={link.href}>
                          <NavigationMenuLink
                            asChild
                            className={cn(
                              "inline-flex h-8 items-center rounded-md px-3 py-1 text-sm font-medium transition-colors hover:bg-accent/50 hover:text-primary focus:bg-accent/50 focus:text-primary focus:outline-none",
                              active && "text-primary font-semibold"
                            )}
                            data-active={active}
                          >
                            <Link href={link.href || "#"}>{link.label}</Link>
                          </NavigationMenuLink>
                        </NavigationMenuItem>
                      )
                    })}
                </NavigationMenuList>
              </NavigationMenu>
            )}
          </div>
        </div>
      </header>
    )
  }
)

Navbar03.displayName = "Navbar03"

export { Logo, HamburgerIcon }