# Production reconciliation — issue #208

Audit date: 2026-11-19. Development: `patient-wombat-877`; production: `dynamic-okapi-82`.

## Vehicle API findings

Read-only snapshot: 229 vehicles, 108 missing a category, 27 flagged. These sets overlap. 100 distinct year/make/model inputs remain after trimming whitespace (103 before trimming). No names, email addresses, VINs or plates were sent to providers.

The direct FuelEconomy sweep found only 19 exact model-menu matches. Canonical make aliases, case/spacing normalization and base-model variant matching recovered category evidence for 66 inputs. These exploratory prefix matches were not used directly to update production.

The app-level development sweep then exercised `vehicleTypes:classify` on all 100 inputs: 68 high-confidence FuelEconomy results, four high-confidence vPIC results, one medium-confidence result and 27 manual-review results. Zero action errors. The approved write set excludes medium/low confidence, AI-only results, existing category conflicts and manual overrides.

- FuelEconomy parameters are canonical menu **values**, not arbitrary case-insensitive user text. Follow year → make → model → options → vehicle. Base names such as `Sorento`, `CRV`, `GX470` and `Tacoma` often need canonical punctuation and drivetrain variants. Evaluate every plausible model/option and require category agreement; never select the first arbitrary trim.
- Whitespace, case, punctuation and drivetrain labels are safe to normalize. Partial words (`4run`), brand/model typos (`Hobda`, `Toyoya`, `Nissisn`), trim-only names (`Denali`, `Elevation`, `STX`) and `Unknown` remain manual work. Do not rewrite the customer's saved vehicle identity or guess from legacy size.
- The ordinary vPIC model listing returns model identity, **without VehicleTypeName**. Typed model requests supply that field. This resolves exact heavy-duty pickup models such as F-250 that are not in the FuelEconomy passenger/light-duty menu.
- `Special Purpose Vehicle` and pickup body variants can coexist for Colorado/Silverado: leave the category unresolved when plausible variants disagree.
- Provider failure, unsupported years, unknown models and incomplete evidence fall back to manual selection. No silent Car pricing.
- The operator-only write helper accepts at most 20 records, rechecks year/make/model, preserves manual overrides and conflicting existing categories, records a before-image, and changes only vehicle category/classification. It never reprices historical orders or subscriptions. Repeat runs skip resolved records.

Provider references: [FuelEconomy menu API](https://www.fueleconomy.gov/feg/ws/), [vPIC typed model API](https://vpic.nhtsa.dot.gov/api/).

### Results for every distinct input

| Year | Saved make | Saved model | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1966 | flinstone | mobile | Manual review | fallback / low: No reliable category |
| 1996 | Mitsubishi | Eclipse | Car | fuelEconomy / high: Subcompact Cars; Minicompact Cars |
| 2002 | Dodge | Ram 2500 | Manual review | fallback / low: No reliable category |
| 2003 | Toyota | 4Runner | SUV | fuelEconomy / high: Sport Utility Vehicle - 2WD; Sport Utility Vehicle - 4WD |
| 2004 | Lexus | Gx470 | SUV | fuelEconomy / high: Sport Utility Vehicle - 4WD |
| 2006 | Toyota | 4run | Manual review | fallback / low: No reliable category |
| 2008 | Hyundai | Accent | Car | fuelEconomy / high: Compact Cars |
| 2009 | Hobda | Accord | Manual review | fallback / low: No reliable category |
| 2010 | Audi | Unknown | Manual review | fallback / low: No reliable category |
| 2010 | Lexus | ES 350 | Car | fuelEconomy / high: Midsize Cars |
| 2012 | Ford | Focus SE | Car | fuelEconomy / high: Compact Cars |
| 2012 | Kia | Sorento | SUV | fuelEconomy / high: Sport Utility Vehicle - 2WD; Sport Utility Vehicle - 4WD |
| 2012 | Toyota | Tundra | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2012 | challenger | rt | Manual review | fallback / low: No reliable category |
| 2013 | Chevrolet | Equinox | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2013 | Hyundai | Sonata | Car | fuelEconomy / high: Large Cars; Midsize Cars |
| 2013 | Lexus | 570 | Manual review | fallback / low: No reliable category |
| 2013 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2014 | Chevy | Silverado | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2014 | GMC | Acadia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2014 | Honda | CR-V | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2014 | Lexus | G350 | Manual review | fallback / low: No reliable category |
| 2014 | Lexus | GS | Car | fuelEconomy / high: Midsize Cars |
| 2014 | f150 | STX | Manual review | fallback / low: No reliable category |
| 2015 | Ford | Mustang | Car | fuelEconomy / high: Subcompact Cars |
| 2015 | GMC | 1500 | Manual review | fallback / low: No reliable category |
| 2015 | TOYOTA | Tacoma | Truck | fuelEconomy / high: Small Pickup Trucks 2WD; Small Pickup Trucks 4WD |
| 2016 | Chevrolet | Colorado | Manual review | fallback / low: Conflicting provider categories; manual confirmation required |
| 2016 | GMC | Sierr 2500HD Denali | Manual review | fallback / low: No reliable category |
| 2016 | Honda | Civic | Car | fuelEconomy / high: Compact Cars; Midsize Cars |
| 2016 | Kia | Soul | Car | fuelEconomy / high: Small Station Wagons |
| 2017 | GMC | Terrain | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2018 | GMC | SIERRA k2500 | Truck | vpic / high: Truck |
| 2018 | Mercedes | Benz GLC 300 | Manual review | fallback / low: No reliable category |
| 2018 | Nissan | Altima | Car | fuelEconomy / high: Midsize Cars |
| 2018 | Subaru | Crosstrek | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2019 | Chevy | Silverado | Manual review | fallback / low: Conflicting provider categories; manual confirmation required |
| 2019 | Ford | Expedition | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2019 | HD | Trike | Manual review | fallback / low: No reliable category |
| 2019 | Honda | crv | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2019 | Jeep | Compass | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2019 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2019 | jeep | compass | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2020 | Chevrolet | silverado  LTZ | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2020 | Jeep | Grand Cherokee L | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2020 | Lincoln | Nautilus | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2020 | bmw | x5 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2021 | Audi | Q5 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2021 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2021 | Denali | Denali | Manual review | fallback / low: No reliable category |
| 2021 | Honda | Odyssey | Van | fuelEconomy / high: Minivan - 2WD |
| 2021 | Mercedes | GLB | Manual review | fallback / low: No reliable category |
| 2021 | Mercedes | GLB 250 | Van | fuelEconomy / medium: Special Purpose Vehicle 2WD |
| 2021 | Nissisn | Armda | Manual review | fallback / low: No reliable category |
| 2021 | Toyota | Prius | Car | fuelEconomy / high: Midsize Cars |
| 2022 | Acura | MDX | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2022 | BMW | X5 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2022 | Dodge | Ram 1500 rebel | Manual review | fallback / low: No reliable category |
| 2022 | Ford | f250 | Truck | vpic / high: Truck |
| 2022 | GMC | Denali | Manual review | fallback / low: No reliable category |
| 2022 | Gmc | Elevation | Manual review | fallback / low: No reliable category |
| 2022 | Mercedes | Gle350 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2022 | Nissan | Titan | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2022 | Volvo | XC90 B6 AWD | Manual review | fallback / low: No reliable category |
| 2023 | Audi | A6 | Car | fuelEconomy / high: Midsize Station Wagons; Midsize Cars |
| 2023 | Cadillac | Xt4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2023 | GMC | Arcadia | Manual review | fallback / low: No reliable category |
| 2023 | GMC | Yukon | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2023 | Gmc | Acadia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD; Standard Sport Utility Vehicle 2WD |
| 2023 | Gmc | Yukon Denali | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2023 | Toyota | Rav 4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2023 | Volvo | Xc40 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2024 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2024 | Chevy | Z71 suburban | Manual review | fallback / low: No reliable category |
| 2024 | Ford | Maverick | Truck | fuelEconomy / high: Small Pickup Trucks 4WD; Small Pickup Trucks 2WD |
| 2024 | Honda | Odyssey | Van | fuelEconomy / high: Minivan - 2WD |
| 2024 | Jeep | Grand Cherokee | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2024 | Kia | Sorento | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD; Small Sport Utility Vehicle 2WD |
| 2024 | Range Rover | Sport | Manual review | fallback / low: No reliable category |
| 2024 | Range Rover | sport | Manual review | fallback / low: No reliable category |
| 2024 | Tesla | Model S | Car | fuelEconomy / high: Large Cars |
| 2024 | Toyota | Camry | Car | fuelEconomy / high: Midsize Cars |
| 2024 | Toyota | Rav4 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 2WD; Small Sport Utility Vehicle 4WD |
| 2024 | Toyota | Tundra | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2024 | Toyoya | Camry | Manual review | fallback / low: No reliable category |
| 2025 | Cadillac | Escalade | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Chevy | Tahoe | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | FORD | F-250 | Truck | vpic / high: Truck |
| 2025 | Ford | f150 | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | GMC | Sierra 1500 4wd | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | GMC | Sierra 2500 HD | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | Gmc | Sierra 2500 | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | Gmc | Yukon | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Lexus | GX 550 | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 4WD |
| 2025 | Toyota | Sequoia | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2025 | Toyota | Tundra 4WD sr5 | Truck | fuelEconomy / high: Standard Pickup Trucks 2WD; Standard Pickup Trucks 4WD |
| 2025 | Volvo | Xc60 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2026 | Audi | Q3 | SUV | fuelEconomy / high: Small Sport Utility Vehicle 4WD |
| 2026 | Chevrolet | Tahoe | SUV | fuelEconomy / high: Standard Sport Utility Vehicle 2WD; Standard Sport Utility Vehicle 4WD |
| 2026 | Ford | F250 | Truck | vpic / high: Truck |

## Google sign-in

Confirmed in Chromium and WebKit with an iPhone 13 profile: `https://www.rivercitymd.com/sign-in` loads Clerk and Continue with Google reaches `accounts.google.com`, with callback `https://clerk.rivercitymd.com/v1/oauth_callback`. No real Google account was signed in, so session completion and Janet's historical failure remain unconfirmed. WebKit is a Safari-engine check, not proof of Janet's specific iOS environment. A WebKit page error ("The provided value is non-finite") did not prevent Google navigation.

Confirmed failure: `https://rivercitymd.vercel.app/sign-in` renders no sign-in UI; Clerk returns HTTP 400 and states production keys are restricted to `rivercitymd.com`. Production alias redirect now sends paths and query parameters to `https://www.rivercitymd.com`. Unique preview deployment hosts are not redirected. Existing OAuth callback pass-through and missing-token loop guards remain covered; missing role verification now fails closed on admin pages.

## Gift cards

Production had no gift card activity at the original audit. Do not create live monetary value or charge a test customer just to manufacture transactions.

Verified fixes: a signed-in purchaser sending a gift no longer becomes its claimant; the intended recipient can join and claim it. Unpaid Stripe cards cannot be activated through balance adjustments. Checkout return origins are restricted to canonical/configured origins, preventing bearer-link redirection. Failed PIN attempts consume durable rate-limit attempts through an action before the transactional claim; the wallet uses that action. Purchase remains pending until fulfillment; replayed activation issues credit only once. Existing reservation, invoice, refund-delta and ledger tests remain required.

OCR scan succeeded using the configured Cloudflare model. Confirmed high-impact findings (checkout origin, admin role verification, failed PIN attempts, unpaid adjustments) were addressed. Public access links intentionally let purchasers print the gift code/PIN: that bearer-link behavior is retained, while untrusted checkout return origins are rejected. General pagination/refactoring suggestions are separate from these incident fixes.

## Production outcome

Pending release and guarded batch application. Manual-review records must remain flagged until a reliable category is available or Dustin confirms the actual vehicle. Janet/Randy's corrected recurring rates and paid invoices must remain unchanged.
