"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "convex/react";
import { Home, Wrench, DollarSign, Gift, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import { getRoleHomePath } from "@/lib/auth-routing";

export default function Navbar() {
  const [activeSection, setActiveSection] = useState("home");
  const userRole = useQuery(api.auth.getUserRole);
  const isSignedIn = Boolean(userRole);

  const dashboardHref =
    userRole?.type === "admin"
      ? getRoleHomePath("admin")
      : getRoleHomePath("client");

  useEffect(() => {
    const handleScroll = () => {
      const sections = [
        "home",
        "services",
        "pricing",
        "testimonials",
        "contact",
      ];
      const scrollPosition = window.scrollY + 200;

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const { offsetTop, offsetHeight } = element;
          if (
            scrollPosition >= offsetTop &&
            scrollPosition < offsetTop + offsetHeight
          ) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative w-10 h-10 transition-transform group-hover:scale-105">
                <Image
                  src="/BoldRiverCityMobileDetailingLogo.png"
                  alt="River City Mobile Detail"
                  fill
                  className="object-contain"
                />
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <Link
                href="#services"
                className="text-sm font-medium hover:text-accent transition-colors"
              >
                Services
              </Link>
              <Link
                href="#pricing"
                className="text-sm font-medium hover:text-accent transition-colors"
              >
                Pricing
              </Link>
              <Link
                href="/gift-cards"
                className="text-sm font-medium hover:text-accent transition-colors"
              >
                Gift Cards
              </Link>
              <Link
                href="#testimonials"
                className="text-sm font-medium hover:text-accent transition-colors"
              >
                Testimonials
              </Link>
              <Link
                href="#contact"
                className="text-sm font-medium hover:text-accent transition-colors"
              >
                Contact
              </Link>
              {isSignedIn ? (
                <Button size="sm" asChild>
                  <Link href={dashboardHref}>Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/sign-in">Login</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/sign-up">Get Started</Link>
                  </Button>
                </>
              )}
            </div>

            <div className="md:hidden flex items-center gap-2">
              {isSignedIn ? (
                <Button size="sm" asChild>
                  <Link href={dashboardHref}>Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/sign-in">Login</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/sign-up">Start</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border pb-safe">
        <div className="grid grid-cols-5 h-16">
          <Link
            href="#home"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "home" ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-xs font-medium">Home</span>
          </Link>
          <Link
            href="#services"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "services"
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <Wrench className="w-5 h-5" />
            <span className="text-xs font-medium">Services</span>
          </Link>
          <Link
            href="#pricing"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "pricing"
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <DollarSign className="w-5 h-5" />
            <span className="text-xs font-medium">Pricing</span>
          </Link>
          <Link
            href="/gift-cards"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "gift-cards"
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <Gift className="w-5 h-5" />
            <span className="text-xs font-medium">Gifts</span>
          </Link>
          <Link
            href="#testimonials"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "testimonials"
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-xs font-medium">Reviews</span>
          </Link>
          <Link
            href="#contact"
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              activeSection === "contact"
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <Phone className="w-5 h-5" />
            <span className="text-xs font-medium">Contact</span>
          </Link>
        </div>
      </nav>
    </>
  );
}
