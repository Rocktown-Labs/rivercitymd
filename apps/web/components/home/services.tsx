"use client";

import {
  Check,
  Clock,
  Sparkles,
  RotateCcw,
  Armchair,
  ShieldCheck,
  Gem,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const services = [
  {
    icon: Clock,
    title: "Maintenance",
    description:
      "Routine upkeep to preserve that clean, fresh finish between major details.",
    features: [
      "Light interior vacuum",
      "Exterior contact wash",
      "Light touchpoint wipe down",
      "Tire dressing",
    ],
  },
  {
    icon: Sparkles,
    title: "Signature",
    description:
      "Our signature balance of thorough exterior hand washing and focused interior care.",
    features: [
      "Door-jamb wipe down",
      "Light spot treatment",
      "Full wipe down",
      "Thorough exterior hand wash",
    ],
  },
  {
    icon: RotateCcw,
    title: "Deep Reset",
    description:
      "Comprehensive deep clean targeting heavy grime, embedded dirt, and stubborn spots.",
    features: [
      "Shampoo & extraction",
      "Thorough interior vacuum",
      "Chemical paint decontamination",
      "Targeted steam clean",
    ],
  },
  {
    icon: Armchair,
    title: "Interior Reset",
    description:
      "Complete cabin restoration with multi-surface agitation, extraction, and protection.",
    features: [
      "Deep brushing & agitation",
      "Shampoo & extraction",
      "Leather protectant",
      "Thorough vacuum",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Decon + Protect",
    description:
      "Chemical paint decontamination coupled with durable high-gloss exterior protection.",
    features: [
      "Iron removal",
      "Remove embedded contaminants",
      "Enhance gloss",
      "Protect against elements",
    ],
  },
  {
    icon: Gem,
    title: "18 mo Ceramic",
    description:
      "Long-lasting ceramic shield delivering intense gloss and durable hydrophobics.",
    features: [
      "Extreme water beading & easy cleaning",
      "Deep gloss, slickness, & clarity",
      "Repel dirt, grime, bugs & sap",
      "Less prone to water spotting",
    ],
  },
];

export function ServicesSection() {
  return (
    <section id="services" className="py-24 bg-secondary/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-bold mb-4 text-balance">
            Professional services for every need
          </h2>
          <p className="text-lg text-muted-foreground">
            From quick refreshes to complete transformations, we offer
            comprehensive detailing solutions tailored to your vehicle.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {services.map((service, index) => {
            const Icon = service.icon;
            const usesTwoColFeatures = service.features.length >= 4;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: index * 0.1 }}
                className="flex flex-col"
              >
                <div className="relative flex flex-col flex-1 rounded-xl border border-border/40 bg-background overflow-hidden transition-all duration-300 hover:border-border/70 hover:shadow-md group">
                  {/* Top accent strip */}
                  <div className="h-[3px] w-full bg-primary/70 flex-shrink-0" />

                  {/* Header */}
                  <div className="px-5 pt-5 pb-4 text-center">
                    {/* Icon + Title inline */}
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                      <h3 className="text-lg font-bold tracking-tight leading-tight">
                        {service.title}
                      </h3>
                    </div>

                    <p className="text-xs text-muted-foreground leading-snug">
                      {service.description}
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="mx-5 h-px bg-border/40" />

                  {/* Features */}
                  <div className="px-5 py-4 flex-1">
                    <ul
                      className={cn(
                        usesTwoColFeatures
                          ? "grid grid-cols-2 gap-x-3 gap-y-1.5"
                          : "flex flex-col gap-y-1.5",
                      )}
                    >
                      {service.features.map((feature, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-xs text-muted-foreground group-hover:text-foreground/80 transition-colors"
                        >
                          <Check
                            className="w-3 h-3 text-primary flex-shrink-0 mt-0.5"
                            strokeWidth={2.5}
                          />
                          <span className="leading-tight">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
