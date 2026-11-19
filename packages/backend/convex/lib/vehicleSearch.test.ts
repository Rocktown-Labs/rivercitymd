import { expect, test } from "vitest";
import { similarVehicleModelScore } from "./vehicleSearch";
import { vehicleModelsMatch } from "./vehicleMatching";

test("nearby model spellings are suggestions, including missing letters and transpositions", () => {
  expect(similarVehicleModelScore("g350", "GS 350 AWD")).toBe(1);
  expect(similarVehicleModelScore("camery", "Camry Hybrid LE")).toBe(1);
  expect(
    similarVehicleModelScore("silvreado", "Silverado Cab Chassis 2WD"),
  ).toBe(1);
  expect(vehicleModelsMatch("G350", "GS 350")).toBe(false);
});

test("similar suggestions preserve model numbers and avoid broad or unrelated guesses", () => {
  expect(similarVehicleModelScore("GS350", "GS450")).toBeNull();
  expect(similarVehicleModelScore("F150", "F1500")).toBeNull();
  expect(similarVehicleModelScore("Denali", "Yukon")).toBeNull();
  expect(similarVehicleModelScore("G350", "IS 350")).toBeNull();
  expect(similarVehicleModelScore("gs", "GS350")).toBeNull();
  expect(similarVehicleModelScore("x".repeat(1000), "Camry")).toBeNull();
});
