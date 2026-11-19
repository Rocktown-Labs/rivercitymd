# Vehicle input research — #212

Reviewed 2026-11-19 using Firecrawl and web search, public manufacturer documents, and live FuelEconomy/NHTSA calls. Only year/make/model were sent to search providers. Customer contact information and plates were not sent.

## Decisions

A spelling repair is an inference from the saved make, model and year supported by the cited factory model documentation. Bare trims cannot identify an owner’s vehicle: searches offer model/body choices rather than assigning one. Manufacturer body-family evidence is used only after a provider confirms that model family for the saved year. EPA fuel economy size classes are not always the app’s service body category.

| Year | Saved input | Reviewed identity | Category | Primary evidence |
| --- | --- | --- | --- | --- |
| 2009 | Hobda Accord | Honda Accord | Car | [Factory document](https://hondanews.com/en-US/honda-automobiles/releases/release-90c51d455aa151f96f3107004c34bcbe-2009-honda-accord-specifications-and-features) |
| 2024 | Toyoya Camry | Toyota Camry | Car | [Factory document](https://pressroom.toyota.com/2024-toyota-camry-style-and-performance-in-americas-best-selling-midsize-sedan/) |
| 2016 | GMC Sierr 2500HD Denali | GMC Sierra 2500HD Denali | Truck | [Factory document](https://www.gmc.com/ownercenter/content/dam/gmownercenter/gmna/dynamic/manuals/2016/GMC/Sierra/2k16sierraden1stPrint.pdf) |
| 2023 | GMC Arcadia | GMC Acadia | SUV | [Factory document](https://www.gmc.com/suvs/acadia) |
| 2006 | Toyota 4run | Toyota 4Runner | SUV | [Factory document](https://pressroom.toyota.com/album/2006-2009-toyota-4runner-fourth-4th-generation/) |
| 2013 | Lexus 570 | Lexus LX 570 | SUV | [Factory document](https://pressroom.lexus.com/lexus-introduces-2013-lx-570-luxury-utility-naias/) |
| 2002 | Dodge Ram 2500 | Dodge Ram 2500 | Truck | [Factory document](https://www.carmanualsonline.info/dodge-ram-2002-service-repair-manual/1) |
| 2012 | challenger rt | Dodge Challenger R/T | Car | [Factory document](https://www.fcapresskit.ca/2012/data/dg_challenger.html) |
| 2021 | Nissisn Armda | Nissan Armada | SUV | [Factory document](https://usa.nissannews.com/en-US/releases/2021-nissan-armada-press-kit) |
| 2014 | f150 STX | Ford F-150 STX | Truck | [Factory document](https://media.ford.com/content/dam/fordmedia/North%20America/US/2014_Specs/2014_F150_Specs.pdf) |

The 2002 Dodge source is an online copy of the factory service manual (VIN decoder identifies Truck / 2500), cross-checked against NHTSA’s model-year Truck listing. The saved 2500 designation is retained; no engine, cab or chassis variant is invented.

## Provider category conflicts

- [Mercedes 2021 GLB brochure](https://www.mbusa.com/content/dam/mb-nafta/us/brochures/pdf/MY21_GLB_WebPDF_03.25.21.pdf): GLB / GLB 250 is an SUV despite EPA wagon and SUV classes across drivetrains.
- [Volvo XC90](https://www.volvocars.com/uk/cars/xc90/) and [2022 factory release](https://jp.volvocars.com/pressrelease/wp-content/uploads/2022/07/vcjpr_220706_01.pdf): SUV; retain the customer’s B6 AWD text without asserting a US engine/trim configuration.
- [Chevrolet Colorado](https://www.chevrolet.com/trucks/colorado), [Silverado](https://www.chevrolet.com/trucks/silverado/1500), and [GMC Sierra](https://www.gmc.com/trucks/sierra/1500): Truck family. Commercial cab/chassis choices remain available. Provider year/model confirmation is still required.
- The existing manual 2025 Sierra 2500 HD category is already Truck. Confirm that same category and clear its stale review flag; preserve the original override identity/timestamp.

## Records still requiring the actual vehicle

- 1966 flinstone mobile: Model/vehicle identity needs confirmation.
- 2022 GMC Denali: Denali is a trim shared by multiple models; choose the actual model.
- 2019 HD Trike: Model/vehicle identity needs confirmation.
- 2014 Lexus G350: Model/vehicle identity needs confirmation.
- 2021 Denali Denali: Model/vehicle identity needs confirmation.
- 2015 GMC 1500: Model/vehicle identity needs confirmation.
- 2022 Gmc Elevation: Elevation is a trim shared by multiple models; choose the actual model.

[2022 Acadia](https://www.gmc.com/content/dam/gmc/na/us/english/index/about/download-brochures/2022-models/02-pdf/GMTK22CT000_MY22_GMC%20ACADIA_DESKTOP_INTERACTIVE_3-25.pdf) and [Terrain](https://www.gmc.com/content/dam/gmc/na/us/english/index/about/download-brochures/2022-models/02-pdf/GMTN22CT000FO_MY22_GMC%20TERRAIN_3-10.pdf) factory brochures also list Elevation Edition. Elevation cannot safely imply a Sierra truck. Denali is shared by GMC trucks and SUVs. “1500” alone does not prove Sierra versus Yukon/Yukon XL 1500 in this historical fleet. Harley Trike needs the actual model and business motorcycle category; Lexus G350 could be a misspelling of different models. The fictional-looking Flintstone entry cannot be researched into a real car.

The old 2010 Audi Unknown record was deleted independently in production and replaced with a typed 2017 Audi Q5. Do not recreate or patch the deleted record.

## Mobile parity

The native lookup uses the same search/classify actions as web. It now displays all eight model/body suggestions, supports the same trim recovery, prevents stale classification responses from replacing customer choices, and requires an explicit category in onboarding, garage creation, and booking. Saved untyped vehicles can receive a category during booking. An iOS bundle export verifies packaging; these UI changes require a new native build, while deployed backend search improvements are shared immediately.

## Sign-in follow-up

The confirmed production hosting-alias failure is addressed by redirecting to the Clerk-authorized canonical domain. Canonical OAuth initiation reached Google in Chromium and iPhone-profile WebKit. Janet’s original account-specific loop cannot be reproduced without her login; completion remains an owner/customer check if it recurs.
