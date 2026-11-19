"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Camera,
  Check,
  Loader2,
  Search,
  Upload,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { parseVehicleSearch as parseVehicleQuery } from "@rivercitymd/backend/convex/lib/vehicleSearch";
import { api } from "@rivercitymd/backend/convex/_generated/api";
import type { Id } from "@rivercitymd/backend/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VehicleSize = "small" | "medium" | "large";

export type VehicleClassification = {
  source: "fuelEconomy" | "vpic" | "manual" | "fallback";
  confidence: "high" | "medium" | "low";
  rawCategory?: string;
  needsAdminReview: boolean;
};

export type BeforePhoto = {
  key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: number;
};

export type VehicleLookupValue = {
  year: string;
  make: string;
  model: string;
  color?: string;
  licensePlate?: string;
  size?: VehicleSize;
  vehicleTypeId?: string;
  vehicleTypeName?: string;
  classification?: VehicleClassification;
  hasPet?: boolean;
  hasHeavySoil?: boolean;
  beforePhotos?: BeforePhoto[];
};

type Suggestion = {
  year: number;
  make: string;
  model: string;
  label: string;
  source: "fuelEconomy" | "vpic";
};

type VehicleLookupCardProps = {
  value: VehicleLookupValue;
  onChange: (value: VehicleLookupValue) => void;
  title?: string;
  showColor?: boolean;
  showLicensePlate?: boolean;
  showPetToggle?: boolean;
  showBeforePhotos?: boolean;
  onRemove?: () => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
};

const MAX_PHOTOS = 6;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const ALLOWED_PHOTO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
]);

function isValidYear(year: string) {
  return /^\d{4}$/.test(year);
}

function normalizeContentType(contentType: string) {
  return contentType.toLowerCase().split(";")[0]?.trim() || "";
}

function getFileExtension(fileName: string) {
  const normalized = fileName.toLowerCase().trim();
  const lastDotIndex = normalized.lastIndexOf(".");
  return lastDotIndex >= 0 ? normalized.slice(lastDotIndex) : "";
}

function getUploadContentType(file: File) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const extension = getFileExtension(file.name);
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".heic") return "image/heic";
  if (extension === ".heif") return "image/heif";
  return "application/octet-stream";
}

function isAllowedPhoto(file: File) {
  const extension = getFileExtension(file.name);
  const contentType = normalizeContentType(file.type);
  const resolvedContentType =
    contentType === "application/octet-stream" || !contentType
      ? getUploadContentType(file)
      : contentType;

  return (
    file.size <= MAX_PHOTO_SIZE_BYTES &&
    (ALLOWED_PHOTO_TYPES.has(resolvedContentType) ||
      ALLOWED_PHOTO_EXTENSIONS.has(extension))
  );
}

function uploadPhotoToSignedUrl(args: {
  url: string;
  file: File;
  contentType: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", args.url);
    xhr.setRequestHeader("Content-Type", args.contentType);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(
        new Error(
          xhr.responseText ||
            `Photo upload failed with status ${xhr.status || "unknown"}`,
        ),
      );
    };
    xhr.onerror = () => {
      reject(
        new Error(
          "Photo upload could not connect to storage. Please try again or continue without photos.",
        ),
      );
    };
    xhr.ontimeout = () => {
      reject(new Error("Photo upload timed out. Please try again."));
    };
    xhr.timeout = 60_000;
    xhr.send(args.file);
  });
}

async function relayPhotoToSignedUrl(args: {
  url: string;
  file: File;
  contentType: string;
}) {
  const response = await fetch("/api/r2-upload-relay", {
    method: "PUT",
    headers: {
      "Content-Type": args.contentType,
      "x-r2-upload-url": args.url,
    },
    body: args.file,
  });

  if (!response.ok) {
    let message =
      "Photo upload failed. Please try again or continue without photos.";
    try {
      const result = await response.clone().json();
      if (typeof result?.error === "string" && result.error.trim()) {
        message = result.error;
      }
    } catch {
      const text = await response.text();
      if (text.trim()) message = text;
    }
    throw new Error(message);
  }
}

async function uploadPhoto(args: {
  url: string;
  file: File;
  contentType: string;
}) {
  try {
    await uploadPhotoToSignedUrl(args);
  } catch {
    await relayPhotoToSignedUrl(args);
  }
}

export function VehicleLookupCard({
  value,
  onChange,
  title = "Vehicle",
  showColor = true,
  showLicensePlate = false,
  showPetToggle = false,
  showBeforePhotos = false,
  onRemove,
  isExpanded,
  onToggleExpanded,
}: VehicleLookupCardProps) {
  const vehicleTypes = useQuery(api.vehicleTypes.list, {});
  const selectionVersion = useRef(0);
  const searchVersion = useRef(0);
  const searchModels = useAction(api.vehicleTypes.searchModels);
  const classifyVehicle = useAction(api.vehicleTypes.classify);
  const createBeforePhotoUploadUrl = useMutation(
    api.bookingDrafts.createBeforePhotoUploadUrl,
  );

  const initialQuery = [value.year, value.make, value.model]
    .filter(Boolean)
    .join(" ");
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [manualVehicle, setManualVehicle] = useState({
    year: value.year ?? "",
    make: value.make ?? "",
    model: value.model ?? "",
    vehicleTypeId: value.vehicleTypeId ?? "",
  });

  useEffect(() => {
    const selectedVehicle = [value.year, value.make, value.model]
      .filter(Boolean)
      .join(" ");
    if (!query && selectedVehicle) {
      setQuery(selectedVehicle);
    }
  }, [query, value.make, value.model, value.year]);

  useEffect(() => {
    const version = ++searchVersion.current;
    let cancelled = false;
    const parsed = parseVehicleQuery(query);
    const canSearch = parsed.make && query.trim().length >= 3;
    if (!canSearch) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchModels({
          query,
        });
        if (!cancelled && version === searchVersion.current)
          setSuggestions(results);
      } catch {
        if (!cancelled && version === searchVersion.current) setSuggestions([]);
      } finally {
        if (!cancelled && version === searchVersion.current)
          setIsSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, searchModels]);

  const detectedLabel = useMemo(() => {
    if (isClassifying) return "Detecting vehicle type...";
    if (value.vehicleTypeName) return `Detected: ${value.vehicleTypeName}`;
    if (value.classification?.needsAdminReview) return "Needs admin review";
    return "Select a vehicle to detect pricing type";
  }, [
    isClassifying,
    value.classification?.needsAdminReview,
    value.vehicleTypeName,
  ]);

  const updateValue = (patch: Partial<VehicleLookupValue>) => {
    onChange({ ...value, ...patch });
  };

  const classifySelection = async (nextValue: VehicleLookupValue) => {
    const version = ++selectionVersion.current;
    onChange(nextValue);
    if (
      nextValue.classification?.source === "manual" &&
      nextValue.vehicleTypeId
    ) {
      setIsClassifying(false);
      return;
    }

    if (!isValidYear(nextValue.year) || !nextValue.make || !nextValue.model) {
      return;
    }

    setIsClassifying(true);
    try {
      const classification = await classifyVehicle({
        year: Number(nextValue.year),
        make: nextValue.make,
        model: nextValue.model,
      });
      if (version !== selectionVersion.current) return;
      onChange({
        ...nextValue,
        size:
          classification.needsAdminReview || !classification.vehicleTypeId
            ? (nextValue.size ?? classification.legacySize)
            : classification.legacySize,
        vehicleTypeId: classification.vehicleTypeId as
          | Id<"vehicleTypes">
          | undefined,
        vehicleTypeName: classification.vehicleTypeName,
        classification: {
          source: classification.source,
          confidence: classification.confidence,
          rawCategory: classification.rawCategory,
          needsAdminReview: classification.needsAdminReview,
        },
      });
    } catch {
      if (version !== selectionVersion.current) return;
      onChange({
        ...nextValue,
        size: nextValue.size ?? "medium",
        classification: {
          source: "fallback",
          confidence: "low",
          needsAdminReview: true,
        },
      });
    } finally {
      if (version === selectionVersion.current) setIsClassifying(false);
    }
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    setIsMenuOpen(false);
    setSuggestions([]);
    setQuery(suggestion.label);
    void classifySelection({
      ...value,
      year: String(suggestion.year),
      make: suggestion.make,
      model: suggestion.model,
    });
  };

  const acceptManualVehicle = () => {
    const year = manualVehicle.year.trim();
    const make = manualVehicle.make.trim();
    const model = manualVehicle.model.trim();
    if (!isValidYear(year) || !make || !model) {
      toast.error("Enter a 4-digit year, make, and model.");
      return;
    }
    const selectedType = vehicleTypes?.find(
      (type) => type._id === manualVehicle.vehicleTypeId,
    );
    if (!selectedType) {
      toast.error("Select a vehicle category.");
      return;
    }
    const nextValue = {
      ...value,
      year,
      make,
      model,
      size: selectedType.legacySize,
      vehicleTypeId: selectedType._id,
      vehicleTypeName: selectedType.name,
      classification: {
        source: "manual" as const,
        confidence: "high" as const,
        rawCategory: "Manual customer entry",
        needsAdminReview: false,
      },
    };
    setQuery([year, make, model].join(" "));
    setIsMenuOpen(false);
    setSuggestions([]);
    setIsManualEntryOpen(false);
    void classifySelection(nextValue);
  };

  const acceptTypedVehicle = () => {
    const typed = parseVehicleQuery(query);
    if (!isValidYear(typed.year) || !typed.make || !typed.model) return;
    setIsMenuOpen(false);
    setSuggestions([]);
    void classifySelection({
      ...value,
      year: typed.year,
      make: typed.make,
      model: typed.model,
    });
  };

  const uploadBeforePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const existingPhotos = value.beforePhotos ?? [];
    const remainingSlots = Math.max(0, MAX_PHOTOS - existingPhotos.length);
    const selectedFiles = Array.from(files).slice(0, remainingSlots);
    if (selectedFiles.length === 0) {
      toast.error(
        `You can upload up to ${MAX_PHOTOS} before photos per vehicle.`,
      );
      return;
    }

    const invalidFile = selectedFiles.find((file) => !isAllowedPhoto(file));
    if (invalidFile) {
      toast.error(
        "Before photos must be JPG, PNG, WEBP, GIF, HEIC, or HEIF under 10MB.",
      );
      return;
    }

    setIsUploading(true);
    try {
      const uploadedPhotos: BeforePhoto[] = [];
      for (const file of selectedFiles) {
        const contentType = getUploadContentType(file);
        const upload = await createBeforePhotoUploadUrl({
          fileName: file.name,
          contentType,
        });
        await uploadPhoto({ url: upload.url, file, contentType });
        uploadedPhotos.push({
          key: upload.key,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          uploadedAt: Date.now(),
        });
      }
      updateValue({
        beforePhotos: [...existingPhotos, ...uploadedPhotos],
      });
      toast.success(
        uploadedPhotos.length === 1
          ? "Before photo uploaded"
          : "Before photos uploaded",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Photo upload failed",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = (key: string) => {
    updateValue({
      beforePhotos: (value.beforePhotos ?? []).filter(
        (photo) => photo.key !== key,
      ),
    });
  };

  const isAccordion = isExpanded !== undefined;
  const showContent = !isAccordion || isExpanded;

  return (
    <div className="relative rounded-md border bg-background p-4">
      <div
        className={`flex items-start justify-between gap-3 ${isAccordion ? "cursor-pointer select-none" : ""}`}
        onClick={isAccordion ? onToggleExpanded : undefined}
      >
        <div className="flex items-center gap-3">
          {isAccordion && (
            <div className="text-muted-foreground mt-0.5">
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          )}
          <div>
            <h4 className="text-sm font-medium">
              {title}
              {value.year || value.make || value.model ? (
                <span className="ml-2 text-foreground font-semibold">
                  {[value.year, value.make, value.model]
                    .filter(Boolean)
                    .join(" ")}
                </span>
              ) : (
                <span className="ml-2 text-muted-foreground italic">
                  (Details pending)
                </span>
              )}
            </h4>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={value.vehicleTypeName ? "default" : "secondary"}>
                {isClassifying && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                {detectedLabel}
              </Badge>
              {value.classification?.rawCategory && (
                <span className="text-xs text-muted-foreground">
                  {value.classification.rawCategory}
                </span>
              )}
            </div>
          </div>
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Remove vehicle</span>
          </Button>
        )}
      </div>

      {showContent && (
        <div className="space-y-4 pt-4 mt-4 border-t border-border/40">
          <div className="relative space-y-2">
            <Label htmlFor={`${title}-vehicle`}>Vehicle</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={`${title}-vehicle`}
                className="pl-9"
                placeholder="Search Kia Sorento or 2020 Kia Sorento"
                value={query}
                onBlur={() => {
                  if (!value.make || !value.model) {
                    acceptTypedVehicle();
                  }
                  setIsMenuOpen(false);
                }}
                onFocus={() => setIsMenuOpen(true)}
                onChange={(event) => {
                  selectionVersion.current++;
                  searchVersion.current++;
                  setIsClassifying(false);
                  setQuery(event.target.value);
                  setIsMenuOpen(true);
                  updateValue({
                    year: "",
                    make: "",
                    model: "",
                    vehicleTypeId: undefined,
                    vehicleTypeName: undefined,
                    classification: undefined,
                  });
                }}
              />
            </div>

            {isMenuOpen &&
              (suggestions.length > 0 ||
                isSearching ||
                query.trim().length >= 3) && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-lg">
                  {isSearching && (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching vehicles...
                    </div>
                  )}
                  {suggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.source}-${suggestion.label}`}
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectSuggestion(suggestion);
                      }}
                    >
                      <span>{suggestion.label}</span>
                    </button>
                  ))}
                  {parseVehicleQuery(query).year &&
                    parseVehicleQuery(query).model && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          acceptTypedVehicle();
                        }}
                      >
                        <Check className="h-4 w-4" />
                        Use &quot;{query.trim()}&quot;
                      </button>
                    )}
                  {!isSearching && suggestions.length === 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        const typed = parseVehicleQuery(query);
                        setManualVehicle((current) => ({
                          ...current,
                          year: typed.year || current.year,
                          make: typed.make || current.make,
                          model: typed.model || current.model,
                        }));
                        setIsManualEntryOpen(true);
                        setIsMenuOpen(false);
                      }}
                    >
                      <Check className="h-4 w-4" />
                      Enter this vehicle manually
                    </button>
                  )}
                </div>
              )}
          </div>

          {isManualEntryOpen && (
            <div className="rounded-md border bg-muted/10 p-3">
              <div className="grid gap-3 sm:grid-cols-[96px_1fr_1fr]">
                <div className="space-y-1">
                  <Label htmlFor={`${title}-manual-year`}>Year</Label>
                  <Input
                    id={`${title}-manual-year`}
                    inputMode="numeric"
                    value={manualVehicle.year}
                    onChange={(event) =>
                      setManualVehicle((current) => ({
                        ...current,
                        year: event.target.value,
                      }))
                    }
                    placeholder="2024"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${title}-manual-make`}>Make</Label>
                  <Input
                    id={`${title}-manual-make`}
                    value={manualVehicle.make}
                    onChange={(event) =>
                      setManualVehicle((current) => ({
                        ...current,
                        make: event.target.value,
                      }))
                    }
                    placeholder="Can-Am"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${title}-manual-model`}>Model</Label>
                  <Input
                    id={`${title}-manual-model`}
                    value={manualVehicle.model}
                    onChange={(event) =>
                      setManualVehicle((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="Spyder RT"
                  />
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`${title}-manual-size`}>Pricing type</Label>
                  <Select
                    value={manualVehicle.vehicleTypeId}
                    onValueChange={(vehicleTypeId) =>
                      setManualVehicle((current) => ({
                        ...current,
                        vehicleTypeId,
                      }))
                    }
                  >
                    <SelectTrigger id={`${title}-manual-size`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicleTypes?.map((type) => (
                        <SelectItem key={type._id} value={type._id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button type="button" onClick={acceptManualVehicle}>
                    Use Vehicle
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsManualEntryOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {value.make && value.model && (
            <div className="space-y-2">
              <Label>Vehicle category</Label>
              <Select
                value={value.vehicleTypeId ?? ""}
                onValueChange={(id) => {
                  const type = vehicleTypes?.find((t) => t._id === id);
                  if (!type) return;
                  selectionVersion.current++;
                  setIsClassifying(false);
                  updateValue({
                    vehicleTypeId: type._id,
                    vehicleTypeName: type.name,
                    size: type.legacySize,
                    classification: {
                      source: "manual",
                      confidence: "high",
                      needsAdminReview: false,
                    },
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose Car, SUV, Truck, etc." />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypes?.map((type) => (
                    <SelectItem key={type._id} value={type._id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(showColor || showLicensePlate) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {showColor && (
                <div className="space-y-2">
                  <Label htmlFor={`${title}-color`}>Color (Optional)</Label>
                  <Input
                    id={`${title}-color`}
                    placeholder="Silver"
                    value={value.color ?? ""}
                    onChange={(event) =>
                      updateValue({ color: event.target.value })
                    }
                  />
                </div>
              )}

              {showLicensePlate && (
                <div className="space-y-2">
                  <Label htmlFor={`${title}-plate`}>
                    License Plate (Optional)
                  </Label>
                  <Input
                    id={`${title}-plate`}
                    value={value.licensePlate ?? ""}
                    onChange={(event) =>
                      updateValue({ licensePlate: event.target.value })
                    }
                  />
                </div>
              )}
            </div>
          )}

          {showPetToggle && (
            <div className="rounded-md border bg-muted/10 p-3">
              <div className="mb-3 space-y-1">
                <Label className="mb-0">
                  Anything we should plan extra time for?
                </Label>
                <p className="text-xs text-muted-foreground">
                  These answers help us recommend the right package level.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={value.hasPet ? "default" : "outline"}
                  className="h-auto justify-start gap-2 px-3 py-2 text-left"
                  onClick={() => updateValue({ hasPet: !value.hasPet })}
                >
                  {value.hasPet && <Check className="h-4 w-4 shrink-0" />}
                  <span>
                    <span className="block text-sm font-semibold">
                      Pet hair or odor?
                    </span>
                    <span className="block text-xs font-normal opacity-80">
                      Helps match interior cleanup needs.
                    </span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={value.hasHeavySoil ? "default" : "outline"}
                  className="h-auto justify-start gap-2 px-3 py-2 text-left"
                  onClick={() =>
                    updateValue({ hasHeavySoil: !value.hasHeavySoil })
                  }
                >
                  {value.hasHeavySoil && <Check className="h-4 w-4 shrink-0" />}
                  <span>
                    <span className="block text-sm font-semibold">
                      Heavy dirt, mud, or trash?
                    </span>
                    <span className="block text-xs font-normal opacity-80">
                      Helps match exterior and cleanup depth.
                    </span>
                  </span>
                </Button>
              </div>
            </div>
          )}

          {showBeforePhotos && (
            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-muted-foreground" />
                  <Label className="mb-0">Before photos (optional)</Label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isUploading ||
                    (value.beforePhotos ?? []).length >= MAX_PHOTOS
                  }
                  asChild
                >
                  <label className="cursor-pointer">
                    {isUploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Upload
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        const input = event.currentTarget;
                        void uploadBeforePhotos(input.files).finally(() => {
                          input.value = "";
                        });
                      }}
                    />
                  </label>
                </Button>
              </div>
              {(value.beforePhotos ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(value.beforePhotos ?? []).map((photo) => (
                    <Badge
                      key={photo.key}
                      variant="secondary"
                      className="gap-2"
                    >
                      <span className="max-w-[150px] truncate">
                        {photo.fileName}
                      </span>
                      <button
                        type="button"
                        className="rounded-full hover:text-destructive"
                        onClick={() => removePhoto(photo.key)}
                      >
                        <X className="h-3 w-3" />
                        <span className="sr-only">Remove photo</span>
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
