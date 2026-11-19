# Production reconciliation — issue #208

Audit date: 2026-11-19. Development: `patient-wombat-877`; production: `dynamic-okapi-82`.

## Vehicle API findings

Read-only snapshot: 229 vehicles, 108 missing a category, 27 flagged. These sets overlap. 100 distinct year/make/model inputs remain after trimming whitespace (103 before trimming). No names, email addresses, VINs or plates were sent to providers.

The direct FuelEconomy sweep found only 19 exact model-menu matches. Canonical make aliases, case/spacing normalization and base-model variant matching recovered category evidence for 66 inputs. These exploratory prefix matches were not used directly to update production.

The final app-level development sweep exercised all 100 inputs: 75 high-confidence FuelEconomy results, 4 high-confidence vPIC results, 12 manufacturer-supported high-confidence results, and 9 unresolved results. All actions returned successfully. Subsequent primary-source research resolves the 2002 Ram 2500 as Truck and supports nine explicit identity spelling/split-field corrections. The reviewed write set contains 101 records; seven current records still require the actual vehicle and one old Audi record has already been deleted independently. See [the cited research](vehicle-research-212.md).

- FuelEconomy parameters are canonical menu **values**, not arbitrary case-insensitive user text. Follow year → make → model → options → vehicle. Base names such as `Sorento`, `CRV`, `GX470` and `Tacoma` often need canonical punctuation and drivetrain variants. Evaluate every plausible model/option and require category agreement; never select the first arbitrary trim.
- Normalize whitespace, case, punctuation and drivetrain labels. Cited research supports specific contextual repairs (`Hobda` → Honda, `Toyoya` → Toyota, `Nissisn Armda` → Nissan Armada, Toyota `4run` → 4Runner). Require provider model/year confirmation; broad partial-word matching remains disabled. Bare trims (`Denali`, `Elevation`, `STX`) need a model choice; `Unknown` remains manual work. Identity changes are limited to the explicitly reviewed repair set, with original identities in the audit trail. Never guess from legacy size.
- The ordinary vPIC model listing returns model identity, **without VehicleTypeName**. Typed model requests supply that field. This resolves exact heavy-duty pickup models such as F-250 that are not in the FuelEconomy passenger/light-duty menu.
- EPA `Special Purpose Vehicle` and pickup classes can coexist for Colorado/Silverado; EPA wagon and SUV classes coexist for GLB. Cited manufacturer body-family evidence resolves these known families after provider year/model confirmation. Other conflicting model/body evidence remains unresolved.
- Provider failure, unsupported years, unknown models and incomplete evidence fall back to manual selection. No silent Car pricing.
- Trim-only search uses data-driven vocabulary from the audited fleet across GMC, Ford, Chevrolet, Toyota, Nissan, Ram/Dodge and Tesla. Unknown marketing trim text on any recognized make recovers to selectable public model/body choices. Full model+trim names also resolve via verified base-model menus. These hints do not claim a complete trim/year compatibility catalog. Commercial cab/chassis variants are retained, and distinct model/body representatives are ranked ahead of repetitive wheel/engine variants.
- Examples tested live: `Denali`, `GMC Denali`, `GMC Yukon Denali`, `STX`, `SR5`, `LTZ`, `Long Range`, Chevrolet Cab Chassis and Ford F250. Google/AI fallback is not configured on dev or production, so government-provider evidence and explicit selection must stand on their own.
- CarQuery was not usable due to a TLS hostname mismatch; CarAPI trim requests returned HTTP 403 without an authenticated feed. Neither was added as an unreliable production dependency.
- The operator-only write helper accepts at most 20 records, rechecks year/make/model, preserves manual overrides and conflicting existing categories, records a before-image, and changes only vehicle category/classification plus explicitly reviewed spelling/split-field repairs. It preserves override identity/timestamps when confirming that same existing category. It never reprices historical orders or subscriptions. Repeat runs skip resolved records.

Provider references: [FuelEconomy menu API](https://www.fueleconomy.gov/feg/ws/), [vPIC typed model API](https://vpic.nhtsa.dot.gov/api/).

Browser check: the development booking form shows Denali model/body choices including Yukon, Yukon XL and Sierra Cab Chassis. Selecting Yukon detects SUV. No booking was submitted.

### Results for every distinct input

| Year | Saved make | Saved model | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1966 | flinstone | mobile | Manual review | fallback / low: No reliable category |
| 1996 | Mitsubishi | Eclipse | Car | fuelEconomy / high: Subcompact Cars; Minicompact Cars |
| 2002 | Dodge | Ram 2500 | Manual review | fallback / low: No reliable category |
| 2003 | Toyota | 4Runner | SUV | fuelEconomy / high: Sport Utility Vehicle - 2WD; Sport Utility Vehicle - 4WD |
| 2004 | Lexus | Gx470 | SUV | fuelEconomy / high: Sport Utility Vehicle - 4WD |
| 2006 | Toyota | 4run | SUV | fuelEconomy / high: Sport Utility Vehicle - 2WD; Sport Utility Vehicle - 4WD |
| 2008 | Hyundai | Accent | Car | fuelEconomy / high: Compact Cars |
| 2009 | Hobda | Accord | Car | fuelEconomy / high: Large Cars; Compact Cars |
| 2010 | Audi | Unknown | Manual review | fallback / low: No reliable category |
| 2010 | Lexus | ES 350 | Car | fuelEconomy / high: Midsize Cars |
| 2012 | Ford | Focus SE | Car | fuelEconomy / high: Compact Cars |
| 2012 | Kia | Sorento | SUV | fuelEconomy / high: Sport Utility Vehicle - 2WD; Sport Utility Vehicle - 4WD |
| 2012 | Toyota | Tundra | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2012 | challenger | rt | Car | fuelEconomy / high: Midsize Cars |
| 2013 | Chevrolet | Equinox | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2013 | Hyundai | Sonata | Car | fuelEconomy / high: Large Cars; Midsize Cars |
| 2013 | Lexus | 570 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2013 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2014 | Chevy | Silverado | Truck | fallback / high: Manufacturer evidence: Chevrolet Silverado is truck; https://www.chevrolet.com/trucks/silverado/1500 |
| 2014 | GMC | Acadia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2014 | Honda | CR-V | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2014 | Lexus | G350 | Manual review | fallback / low: No reliable category |
| 2014 | Lexus | GS | Car | fuelEconomy / high: Midsize Cars |
| 2014 | f150 | STX | Truck | vpic / high: Truck |
| 2015 | Ford | Mustang | Car | fuelEconomy / high: Subcompact Cars |
| 2015 | GMC | 1500 | Manual review | fallback / low: No reliable category |
| 2015 | TOYOTA | Tacoma | Truck | fuelEconomy / high: Small Pickup Trucks 2WD; Small Pickup Trucks 4WD |
| 2016 | Chevrolet | Colorado | Truck | fallback / high: Manufacturer evidence: Chevrolet Colorado is truck; https://www.chevrolet.com/trucks/colorado |
| 2016 | GMC | Sierr 2500HD Denali | Truck | fallback / high: Manufacturer evidence: GMC Sierra is truck; https://www.gmc.com/trucks/sierra/1500 |
| 2016 | Honda | Civic | Car | fuelEconomy / high: Compact Cars; Midsize Cars |
| 2016 | Kia | Soul | Car | fuelEconomy / high: Small Station Wagons |
| 2017 | GMC | Terrain | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2018 | GMC | SIERRA k2500 | Truck | fallback / high: Manufacturer evidence: GMC Sierra is truck; https://www.gmc.com/trucks/sierra/1500 |
| 2018 | Mercedes | Benz GLC 300 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2018 | Nissan | Altima | Car | fuelEconomy / high: Midsize Cars |
| 2018 | Subaru | Crosstrek | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2019 | Chevy | Silverado | Truck | fallback / high: Manufacturer evidence: Chevrolet Silverado is truck; https://www.chevrolet.com/trucks/silverado/1500 |
| 2019 | Ford | Expedition | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2019 | HD | Trike | Manual review | fallback / low: No reliable category |
| 2019 | Honda | crv | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2019 | Jeep | Compass | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2019 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2019 | jeep | compass | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2020 | Chevrolet | silverado  LTZ | Truck | fallback / high: Manufacturer evidence: Chevrolet Silverado is truck; https://www.chevrolet.com/trucks/silverado/1500 |
| 2020 | Jeep | Grand Cherokee L | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2020 | Lincoln | Nautilus | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2020 | bmw | x5 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2021 | Audi | Q5 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2021 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2021 | Denali | Denali | Manual review | fallback / low: No reliable category |
| 2021 | Honda | Odyssey | Van | fuelEconomy / high: Minivan - 2WD |
| 2021 | Mercedes | GLB | SUV | fallback / high: Manufacturer evidence: Mercedes-Benz GLB is suv; https://www.mbusa.com/content/dam/mb-nafta/us/brochures/pdf/MY21_GLB_WebPDF_03.25.21.pdf |
| 2021 | Mercedes | GLB 250 | SUV | fallback / high: Manufacturer evidence: Mercedes-Benz GLB is suv; https://www.mbusa.com/content/dam/mb-nafta/us/brochures/pdf/MY21_GLB_WebPDF_03.25.21.pdf |
| 2021 | Nissisn | Armda | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2021 | Toyota | Prius | Car | fuelEconomy / high: Midsize Cars |
| 2022 | Acura | MDX | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2022 | BMW | X5 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2022 | Dodge | Ram 1500 rebel | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2022 | Ford | f250 | Truck | vpic / high: Truck |
| 2022 | GMC | Denali | Manual review | fallback / low: Denali is a trim shared by multiple models; choose the actual model |
| 2022 | Gmc | Elevation | Manual review | fallback / low: Elevation is a trim shared by multiple models; choose the actual model |
| 2022 | Mercedes | Gle350 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2022 | Nissan | Titan | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2022 | Volvo | XC90 B6 AWD | SUV | fallback / high: Manufacturer evidence: Volvo XC90 is suv; https://www.volvocars.com/uk/cars/xc90/ |
| 2023 | Audi | A6 | Car | fuelEconomy / high: Midsize Station Wagons; Midsize Cars |
| 2023 | Cadillac | Xt4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2023 | GMC | Arcadia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2023 | GMC | Yukon | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2023 | Gmc | Acadia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2023 | Gmc | Yukon Denali | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2023 | Toyota | Rav 4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2023 | Volvo | Xc40 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2024 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2024 | Chevy | Z71 suburban | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2024 | Ford | Maverick | Truck | fuelEconomy / high: Small Pickup Trucks 4WD; Small Pickup Trucks 2WD |
| 2024 | Honda | Odyssey | Van | fuelEconomy / high: Minivan - 2WD |
| 2024 | Jeep | Grand Cherokee | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2024 | Kia | Sorento | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2024 | Range Rover | Sport | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2024 | Range Rover | sport | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2024 | Tesla | Model S | Car | fuelEconomy / high: Large Cars |
| 2024 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2024 | Toyota | Rav4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2024 | Toyota | Tundra | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2024 | Toyoya | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2025 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Chevy | Tahoe | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | FORD | F-250 | Truck | vpic / high: Truck |
| 2025 | Ford | f150 | Truck | fuelEconomy / high: Standard Pickup Trucks 4WD; Standard Pickup Trucks 2WD |
| 2025 | GMC | Sierra 1500 4wd | Truck | fallback / high: Manufacturer evidence: GMC Sierra is truck; https://www.gmc.com/trucks/sierra/1500 |
| 2025 | GMC | Sierra 2500 HD | Truck | fallback / high: Manufacturer evidence: GMC Sierra is truck; https://www.gmc.com/trucks/sierra/1500 |
| 2025 | Gmc | Sierra 2500 | Truck | fallback / high: Manufacturer evidence: GMC Sierra is truck; https://www.gmc.com/trucks/sierra/1500 |
| 2025 | Gmc | Yukon | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Lexus | GX 550 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2025 | Toyota | Sequoia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Toyota | Tundra 4WD sr5 | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | Volvo | Xc60 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2026 | Audi | Q3 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2026 | Chevrolet | Tahoe | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2026 | Ford | F250 | Truck | vpic / high: Truck |

### Remaining owner confirmation

The user requested further web research after the initial queue was prepared. That research reduced 24 initially uncertain records to seven current owner confirmations; the deleted Audi is skipped. No body/model is inferred from Denali, Elevation, or another ambiguous trim. Detailed decisions and primary citations are in [vehicle-research-212.md](vehicle-research-212.md).

## Google sign-in

Confirmed in Chromium and WebKit with an iPhone 13 profile: `https://www.rivercitymd.com/sign-in` loads Clerk and Continue with Google reaches `accounts.google.com`, with callback `https://clerk.rivercitymd.com/v1/oauth_callback`. No real Google account was signed in, so session completion and Janet's historical failure remain unconfirmed. WebKit is a Safari-engine check, not proof of Janet's specific iOS environment. A WebKit page error ("The provided value is non-finite") did not prevent Google navigation.

Confirmed failure: `https://rivercitymd.vercel.app/sign-in` renders no sign-in UI; Clerk returns HTTP 400 and states production keys are restricted to `rivercitymd.com`. Production alias redirect now sends paths and query parameters to `https://www.rivercitymd.com`. Unique preview deployment hosts are not redirected. Existing OAuth callback pass-through and missing-token loop guards remain covered; missing role verification now fails closed on admin pages.

## Gift cards

Production had no gift card activity at the original audit. Do not create live monetary value or charge a test customer just to manufacture transactions.

Verified fixes: a signed-in purchaser sending a gift no longer becomes its claimant; the intended recipient can join and claim it. Unpaid Stripe cards cannot be activated through balance adjustments. Checkout return origins are restricted to canonical/configured origins, preventing bearer-link redirection. Failed PIN attempts consume durable rate-limit attempts through an action before the transactional claim; the wallet uses that action. Purchase remains pending until fulfillment; replayed activation issues credit only once. Existing reservation, invoice, refund-delta and ledger tests remain required.

Earlier OCR scans succeeded using the configured Cloudflare model. A further native/reconciliation scan was incomplete because Cloudflare returned HTTP 429; its partial results do not certify the new files. The completed reconciliation review found a padded-field idempotency edge case, now regression-tested. Retaining manual provenance for researched spelling repairs and refusing conflicting existing category changes are intentional safeguards; already-resolved manual choices are not re-audited on every repeat run. Confirmed high-impact findings (checkout origin, admin role verification, failed PIN attempts, unpaid adjustments) were addressed. Public access links intentionally let purchasers print the gift code/PIN: that bearer-link behavior is retained, while untrusted checkout return origins are rejected. General pagination/refactoring suggestions are separate from these incident fixes.

Development rehearsal: the initial pass updated 69 available records and flagged 18 previously unflagged records. After the final input refinements, a repeated pass updated two more records; already-resolved and unavailable records were safely skipped. The expanded research rehearsal updated ten additional available records (including identity spelling fixes), safely skipping resolved, changed, or missing records. The older development snapshot does not contain every newer production vehicle. Unit tests separately cover before-images, repeated runs, stale identities and manual overrides.

Owner confirmation is tracked in [#212](https://github.com/Rocktown-Labs/rivercitymd/issues/212).

## Production outcome

Prepared 101 reviewed category/identity corrections and seven current owner confirmations, plus a deleted historical Audi to skip. Pending release and guarded batch application. Manual-review records must remain flagged until a reliable category is available or Dustin confirms the actual vehicle. Janet/Randy's corrected recurring rates and paid invoices must remain unchanged.
