import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getEffectiveServicePrice, type VehicleSize } from "./pricing";

// Category prices are authoritative. A legacy size cannot distinguish an SUV
// from a truck, so never choose the first matching row for an untyped vehicle.
export async function getSubscriptionPlanPriceForVehicle(
  ctx: Pick<QueryCtx, "db">,
  plan: Doc<"services">,
  vehicle: Pick<Doc<"vehicles">, "vehicleTypeId" | "size">,
  fallbackSize: VehicleSize = "medium",
): Promise<number> {
  const rows = await ctx.db
    .query("serviceVehiclePrices")
    .withIndex("by_service", (q) => q.eq("serviceId", plan._id))
    .take(100);
  if (rows.length === 0)
    return getEffectiveServicePrice(plan, vehicle.size ?? fallbackSize);
  if (!vehicle.vehicleTypeId) {
    throw new ConvexError({
      code: "VEHICLE_TYPE_REQUIRED",
      message:
        "Select a vehicle category (Car, SUV, Truck, etc.) before enrolling in the Maintenance Club.",
    });
  }
  const type = await ctx.db.get(vehicle.vehicleTypeId);
  if (!type?.isActive) return 0;
  const row = rows.find((r) => r.vehicleTypeId === vehicle.vehicleTypeId);
  return row?.isAvailable && Number.isFinite(row.price) && row.price > 0
    ? row.price
    : 0;
}
