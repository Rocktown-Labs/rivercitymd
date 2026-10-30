import Link from "next/link";
import Image from "next/image";
import { Facebook, Instagram } from "lucide-react";

export function Footer() {
  const quickLinks = [
    { href: "#services", label: "Services" },
    { href: "#pricing", label: "Pricing" },
    { href: "/gift-cards", label: "Gift Cards" },
    { href: "#testimonials", label: "Testimonials" },
    { href: "#contact", label: "Contact" },
  ];

  const services = [
    "Express Detail",
    "Full Detail",
    "Paint Correction",
    "Ceramic Coating",
    "Interior Detail",
  ];

  const contactInfo = ["(501) 454-7140", "Little Rock, AR", "Mon-Sun: 6am-8pm"];

  const socialLinks = [
    {
      href: "https://www.facebook.com/profile.php?id=61577766790127",
      icon: Facebook,
      label: "Facebook",
    },
    {
      href: "https://www.instagram.com/rivercitymobiledetails?igsh=MTliMml3YnpmNnlndw==",
      icon: Instagram,
      label: "Instagram",
    },
  ];

  const legalLinks = [
    { href: "#", label: "Privacy Policy" },
    { href: "#", label: "Terms of Service" },
  ];

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-14">
                <Image
                  src="/BoldRiverCityMobileDetailingLogo.png"
                  alt="River City Mobile Detail"
                  fill
                  className="object-contain"
                />
              </div>
            </div>
            <p className="text-sm text-primary-foreground/80">
              Professional mobile car detailing services in Central Arkansas.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="font-semibold mb-4">Services</h3>
            <ul className="space-y-2 text-sm text-primary-foreground/80">
              {services.map((service) => (
                <li key={service}>{service}</li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <ul className="space-y-2 text-sm text-primary-foreground/80">
              {contactInfo.map((info) => (
                <li key={info}>{info}</li>
              ))}
            </ul>
            <div className="flex gap-4 mt-4">
              {socialLinks.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.label}
                    href={social.href}
                    className="hover:text-primary-foreground transition-colors"
                    aria-label={social.label}
                  >
                    <Icon className="w-5 h-5" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-primary-foreground/20 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-primary-foreground/60">
          <div>© {new Date().getFullYear()} River City Mobile Detail. All rights reserved.</div>
          <div className="flex gap-6">
            {legalLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="hover:text-primary-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
