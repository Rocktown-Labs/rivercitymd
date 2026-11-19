import { expect, test } from "vitest";
import {
  vehicleModelsMatch,
  normalizeVehicleMake,
  normalizeVehicleInput,
} from "./vehicleMatching";

test("spacing and punctuation do not change a model, but partial words and trim-only names remain unresolved", () => {
  expect(vehicleModelsMatch("crv", "CR-V AWD")).toBe(true);
  expect(vehicleModelsMatch("GX470", "GX 470")).toBe(true);
  expect(vehicleModelsMatch("4run", "4Runner")).toBe(false);
  expect(vehicleModelsMatch("Denali", "Yukon Denali")).toBe(false);
  expect(vehicleModelsMatch("F250", "F-250")).toBe(true);
  expect(normalizeVehicleMake(" Chevy ")).toBe("Chevrolet");
});

test("model-family boundaries survive capacity numbers and trim prefixes", () => {
  expect(vehicleModelsMatch("Sierra 2500 HD Denali", "Sierra")).toBe(true);
  expect(vehicleModelsMatch("Z71 Suburban", "Suburban 4WD")).toBe(true);
  expect(vehicleModelsMatch("F-150", "F150 Pickup 4WD")).toBe(true);
  expect(vehicleModelsMatch("F150", "F1500")).toBe(false);
  expect(vehicleModelsMatch("Sport", "Bronco Sport")).toBe(false);
  expect(vehicleModelsMatch("4run", "4Runner")).toBe(false);
});

test("researched input aliases retain explicit model/trim identity without inferring bare GMC trims", () => {
  expect(normalizeVehicleInput("Hobda", "Accord", 2009)).toEqual({
    make: "Honda",
    model: "Accord",
  });
  expect(normalizeVehicleInput("Nissisn", "Armda", 2021)).toEqual({
    make: "Nissan",
    model: "Armada",
  });
  expect(normalizeVehicleInput("f150", "STX", 2014)).toEqual({
    make: "Ford",
    model: "F-150 STX",
  });
  expect(normalizeVehicleInput("challenger", "rt", 2012)).toEqual({
    make: "Dodge",
    model: "Challenger R/T",
  });
  expect(normalizeVehicleInput("GMC", "Denali", 2022)).toEqual({
    make: "GMC",
    model: "Denali",
  });
});
