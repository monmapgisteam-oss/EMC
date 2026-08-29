/* ==========================================================================
   Сервисүүд, Excel-ийн баганын зураглал, холболтын түлхүүрүүд
   --------------------------------------------------------------------------
   ЗАРЧИМ: ArcGIS сервисээс ЗӨВХӨН ГЕОМЕТР авна. Бүх тоон утга
   «mes1-12 нэгтгэл 2023 ArcGIS.xlsx» -> «Нийт орд arcgis» sheet-ээс
   (public/data/excel.json) уншигдана.
   ========================================================================== */

const AGOL = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services";

export const SVC = {
  /** Овоолго — 3D сцен */
  pileScene: `${AGOL}/${encodeURIComponent("Нийт_овоолго_2026")}/SceneServer`,
  /** Овоолго — 2D хүрээ */
  pile2d: `${AGOL}/Owoolgo_medee/FeatureServer/4`,
  /** Хаягдлын далан */
  dam: `${AGOL}/Lake2024_update241016/FeatureServer/0`,
  /** Зам — орчны мэдээлэл */
  roads: `${AGOL}/Engineering_EMC/FeatureServer/22`,
  /** Үйлдвэрийн барилга — 3D сцен */
  bld: `${AGOL}/Multipatch_EMC/SceneServer`,
  /** Мөн барилгын атрибутыг ЭНДЭЭС уншина (доорх тайлбарыг үз) */
  bldFS: `${AGOL}/Multipatch_EMC/FeatureServer/0`,
} as const;

/** Excel-ийн 15 утгын багана (D..R) -> индекс */
export const C = {
  NOOC: 0, BU_U: 1, AGU: 2, BOH: 3, HAY: 4, BOHP: 5, BU: 6,
  OV12: 7, OV14: 8, OV8A: 9, NIIT: 10, OV9A: 11, OV9B: 12,
  HOOSON: 13, TSUL: 14,
} as const;

export const COL_NAMES = {
  mn: [
    "Олборлосон үйлдвэрлэлийн нөөц (захын агуулга 0.25%)",
    "Үүнээс — БҮ-т",
    "Үүнээс — Агуулахад гаргасан хүдэр (хаягдал)",
    "Бохирдол, нийт",
    "Захын агуулга 0.25% — хаягдал",
    "Захын агуулга 0.25% — бохирдол",
    "Нийт олборлосон хүдэр — БҮ-т",
    "Нийт олборлосон хүдэр — Овоолго 12",
    "Нийт олборлосон хүдэр — Овоолго 14",
    "Нийт олборлосон хүдэр — Овоолго 8а",
    "Нийт олборлосон хүдэр — нийт",
    "Балансын бус хүдэр — 9а, 8, 9 овоолгод",
    "Балансын бус хүдэр — 9б овоолгод",
    "Хоосон чулуулаг — Овоолго №1, 4, 11",
    "Нийт уулын цул",
  ],
  en: [
    "Mined reserve (0.25% cut-off)",
    "of which — to concentrator",
    "of which — to storage (reject)",
    "Dilution, total",
    "0.25% cut-off — reject",
    "0.25% cut-off — dilution",
    "Total ore mined — to concentrator",
    "Total ore mined — Stockpile 12",
    "Total ore mined — Stockpile 14",
    "Total ore mined — Stockpile 8a",
    "Total ore mined — total",
    "Sub-grade ore — to piles 9a, 8, 9",
    "Sub-grade ore — to pile 9b",
    "Waste rock — piles №1, 4, 11",
    "Total rock moved",
  ],
} as const;

export const COL_UNITS = {
  mn: ["кт","кт","кт","кт","%","%","кт","кт","кт","кт","кт","кт","кт","м³","м³"],
  en: ["kt","kt","kt","kt","%","%","kt","kt","kt","kt","kt","kt","kt","m³","m³"],
} as const;

/* -------------------------------------------------------------- холболт */

/** Excel «Блок» -> овоолгын феатурын нэр (RefName / dugaar) */
export const BLK2PILE: Record<string, string> = {
  "12": "Овоолго 12",
  "14": "Овоолго 14",
  "8a": "Овоолго 8а",   // Excel-д латин «a», сервист кирилл «а»
  "2б": "Овоолго 2б",
};

/** Excel багана -> тухайн багана хаана очдог овоолгууд */
export const COL2PILES: Record<number, string[]> = {
  [C.OV12]:   ["Овоолго 12"],
  [C.OV14]:   ["Овоолго 14"],
  [C.OV8A]:   ["Овоолго 8а"],
  [C.OV9A]:   ["Овоолго 9а", "Овоолго 8", "Овоолго 9"],
  [C.OV9B]:   ["Овоолго 9б"],
  [C.HOOSON]: ["Овоолго 1", "Овоолго 4", "Овоолго 11"],
};

/** урвуу: овоолгын нэр -> Excel багана */
export const PILE2COL: Record<string, number> = {};
for (const ci of Object.keys(COL2PILES)) {
  for (const nm of COL2PILES[Number(ci)]) PILE2COL[nm] = Number(ci);
}

/** Excel-д дурдагдсан овоолгууд — ЗӨВХӨН эдгээр газрын зураг дээр гарна */
export const EXCEL_PILES = Array.from(
  new Set([...Object.keys(PILE2COL), ...Object.values(BLK2PILE)]),
);

export function pileWhere(field: string): string {
  return `${field} IN (${EXCEL_PILES.map((n) => `'${n}'`).join(",")})`;
}

/**
 * Multipatch_EMC — үйлдвэрийн 532 барилга.
 *   type1 = 1  ->  БАЯЖУУЛАХ ҮЙЛДВЭР (54 феатур)  ->  Excel «Блок = БҮ»
 *   type1 = 2  ->  энгийн барилга    (478)        ->  зөвхөн орчны мэдээлэл
 *
 * Нэрээр ялгаж БОЛОХГҮЙ: «Том бутлуурын корпус» гэдэг нэр хоёуланд нь
 * давхардаж байна (4 нь type1=1, 9 нь type1=2).
 */
export const BU_TYPE = 1;

/** Барилгын өнгө нь СЕРВИС дээрээ тодорхойлогдсон — renderer дарахгүй */
export const BLD_COLOR = { bu: "#ffebbe", other: "#e1e1e1" } as const;

/** Питийн хаялбарууд — Excel-ийн «Түвшин» баганын бүх утга */
export const ELEV = [
  1460, 1445, 1430, 1415, 1400, 1385, 1370, 1355, 1340, 1325,
  1310, 1295, 1280, 1265, 1250, 1235, 1220, 1205, 1190, 1175,
];

/** Суурь зураг — Esri-гийн вектор сан API key шаарддаг тул
 *  түлхүүр шаардахгүй services.arcgisonline.com кэшийг ашиглана */
export const BASEMAPS = {
  imagery: { nm: { mn: "Хиймэл дагуул", en: "Imagery" },
             url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" },
  topo:    { nm: { mn: "Байр зүй", en: "Topographic" },
             url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer" },
  gray:    { nm: { mn: "Саарал", en: "Gray canvas" },
             url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer" },
  graylt:  { nm: { mn: "Цайвар саарал", en: "Light canvas" },
             url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer" },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;

export const ELEV_URL =
  "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";

/** Газрын гадаргуугийн тунгалаг байдал: бүтэн · хагас · унтраасан */
export const GROUND_OPACITY = [1, 0.62, 0];
export const GROUND_NM = {
  mn: ["Бүтэн", "Хагас", "Унтраах"],
  en: ["Solid", "Half", "Off"],
} as const;
