import { expect, test } from "vitest";
import { computeNextDate } from "./subscriptionDates";
import { parseVehicleSearch } from "./vehicleSearch";

test("monthly visits clamp to February rather than skipping it", () => {
  expect(computeNextDate("monthly", "2027-01-31")).toBe("2027-02-28");
  expect(computeNextDate("monthly", "2028-01-31")).toBe("2028-02-29");
  expect(computeNextDate("monthly", "2026-12-20")).toBe("2027-01-20");
  expect(computeNextDate("monthly", "2027-02-28", 31)).toBe("2027-03-31");
  expect(computeNextDate("biweekly", "2026-12-25")).toBe("2027-01-08");
});

test("vehicle entry preserves multiword makes and accepts missing years and mixed case", () => {
  expect(parseVehicleSearch("  2020 LAND ROVER Range Rover ")).toEqual({
    year: "2020",
    make: "LAND ROVER",
    model: "Range Rover",
  });
  expect(parseVehicleSearch("tesla Model S")).toEqual({
    year: "",
    make: "tesla",
    model: "Model S",
  });
  expect(parseVehicleSearch("2014 Chevy Silverado")).toEqual({
    year: "2014",
    make: "Chevrolet",
    model: "Silverado",
  });
});
