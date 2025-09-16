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
  signInText?: string
  signInHref?: string
  ctaText?: string
  ctaHref?: string
  onSignInClick?: () => void
  onCtaClick?: () => void
}

/* --------- Real routes (no "#") --------- */
const defaultNavigationLinks: Navbar03NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/pricing", label: "Pricing" },
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
      signInText = "Sign In",
      signInHref = "/signin",
      ctaText = "Get Started",
      ctaHref = "/booth",
      onSignInClick,
      onCtaClick,
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
          "sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6 [&_*]:no-underline",
          className
        )}
        {...props}
      >
        <div className="container mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4">
          {/* Left */}
          <div className="flex items-center gap-2">
            {/* Mobile menu */}
            {isMobile && (
              <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
                <PopoverTrigger asChild>
                  <Button
                    className="group h-9 w-9 hover:bg-accent hover:text-accent-foreground"
                    variant="ghost"
                    size="icon"
                    aria-label="Open menu"
                  >
                    <HamburgerIcon />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-1">
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
                            className={cn("justify-start", active && "font-semibold")}
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
            <Button asChild variant="link" className="px-0 text-primary hover:text-primary/90">
              <Link href={logoHref} className="flex items-center space-x-2">
                <span className="text-2xl">{logo}</span>
                <span className="hidden font-bold text-xl sm:inline-block">shadcn.io</span>
              </Link>
            </Button>

            {/* Desktop nav */}
            {!isMobile && (
              <NavigationMenu className="flex">
                <NavigationMenuList className="gap-1">
                  {navigationLinks
                    .filter((l) => !l.authOnly)
                    .map((link) => {
                      const active = isActive(link.href)
                      return (
                        <NavigationMenuItem key={link.href}>
                          <NavigationMenuLink
                            asChild
                            className={cn(
                              "group inline-flex h-10 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[active]:bg-accent/50 data-[state=open]:bg-accent/50 relative",
                              "before:absolute before:bottom-0 before:left-0 before:right-0 before:h-0.5 before:bg-primary before:scale-x-0 before:transition-transform before:duration-300 group-hover:before:scale-x-100",
                              active && "before:scale-x-100 text-primary font-semibold"
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

          {/* Right */}
          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              onClick={onSignInClick}
            >
              <Link href={signInHref}>{signInText}</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="text-sm font-medium px-4 h-9 rounded-md shadow-sm"
              onClick={onCtaClick}
            >
              <Link href={ctaHref}>{ctaText}</Link>
            </Button>
          </div>
        </div>
      </header>
    )
  }
)

Navbar03.displayName = "Navbar03"

export { Logo, HamburgerIcon }
