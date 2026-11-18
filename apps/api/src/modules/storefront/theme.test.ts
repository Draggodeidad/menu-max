import { THEME_PRESET_COLORS, THEME_PRESETS } from "@menu-max/contracts";
import { describe, expect, it } from "vitest";
import {
  contrastErrors,
  contrastRatio,
  customizedFields,
  DEFAULT_STORED_THEME,
  effectiveTheme,
  firstFreeSlug,
  slugBase,
  type StoredTheme,
} from "./theme";

const pro = { customTheme: true, removeBranding: true };
const free = { customTheme: false, removeBranding: false };

describe("contrastRatio", () => {
  it("negro sobre blanco es 21:1 y un color consigo mismo 1:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#1F5C45", "#1F5C45")).toBe(1);
  });

  it("coincide con valores de referencia de WCAG", () => {
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it.each(THEME_PRESETS)("el preset %s cumple AA en color principal y texto", (preset) => {
    expect(contrastErrors(THEME_PRESET_COLORS[preset])).toBeUndefined();
  });
});

describe("contrastErrors", () => {
  it("señala el color principal y pide uno más oscuro sobre fondo claro", () => {
    const errors = contrastErrors({
      primaryColor: "#FFEE00",
      backgroundColor: "#FFFFFF",
      textColor: "#1C1F1A",
    });
    expect(Object.keys(errors ?? {})).toEqual(["primaryColor"]);
    expect(errors?.primaryColor?.[0]).toContain("más oscuro");
  });

  it("señala el texto y pide uno más claro sobre fondo oscuro", () => {
    const errors = contrastErrors({
      primaryColor: "#F5A300",
      backgroundColor: "#17191A",
      textColor: "#333333",
    });
    expect(Object.keys(errors ?? {})).toEqual(["textColor"]);
    expect(errors?.textColor?.[0]).toContain("más claro");
  });

  it("4.47:1 no alcanza AA y la razón se trunca, nunca se redondea hacia arriba", () => {
    const errors = contrastErrors({
      primaryColor: "#777777",
      backgroundColor: "#FFFFFF",
      textColor: "#000000",
    });
    expect(errors?.primaryColor?.[0]).toContain("4.47:1");
  });
});

const custom: StoredTheme = {
  preset: "dark",
  primaryColor: "#FFD54F",
  backgroundColor: "#0D1B2A",
  textColor: "#E0E1DD",
  fontPreset: "serif",
  productLayout: "grid",
  logoAssetId: "logo",
  coverAssetId: "cover",
  showBranding: false,
};

describe("effectiveTheme", () => {
  it("con todo el plan, el comensal ve lo guardado", () => {
    expect(effectiveTheme(custom, pro)).toEqual({
      ...custom,
      primaryColor: "#FFD54F",
    });
  });

  it("sin customTheme: preset y color principal, sin imágenes; sin removeBranding, sello", () => {
    const preset = THEME_PRESET_COLORS.dark;
    expect(effectiveTheme(custom, free)).toEqual({
      preset: "dark",
      primaryColor: "#FFD54F",
      backgroundColor: preset.backgroundColor,
      textColor: preset.textColor,
      fontPreset: "sans",
      productLayout: "list",
      logoAssetId: null,
      coverAssetId: null,
      showBranding: true,
    });
  });

  it("si el color principal no contrasta con el fondo del preset, usa el del preset", () => {
    const light = { ...custom, preset: "minimal" as const, primaryColor: "#FFFFFF" };
    expect(effectiveTheme(light, free).primaryColor).toBe(THEME_PRESET_COLORS.minimal.primaryColor);
  });

  it("sin tema guardado, el preset minimal con sello", () => {
    expect(effectiveTheme(DEFAULT_STORED_THEME, pro)).toMatchObject({
      ...THEME_PRESET_COLORS.minimal,
      fontPreset: "sans",
      showBranding: true,
    });
  });
});

describe("customizedFields", () => {
  it("solo cuenta valores personalizados; null y los valores por defecto no", () => {
    expect(customizedFields({ preset: "dark", primaryColor: "#123456" })).toEqual([]);
    expect(
      customizedFields({
        backgroundColor: null,
        logoAssetId: null,
        fontPreset: "sans",
        productLayout: "list",
      }),
    ).toEqual([]);
    expect(
      customizedFields({
        backgroundColor: "#000000",
        textColor: "#FFFFFF",
        fontPreset: "serif",
        productLayout: "grid",
        logoAssetId: "a",
        coverAssetId: "b",
      }),
    ).toEqual([
      "backgroundColor",
      "textColor",
      "logoAssetId",
      "coverAssetId",
      "fontPreset",
      "productLayout",
    ]);
  });
});

describe("slugBase", () => {
  it.each([
    ["Tacos El Güero", "tacos-el-guero"],
    ["Café Ñandú", "cafe-nandu"],
    ["  La   Pozolería!!  ", "la-pozoleria"],
    ["Tortas & Jugos #2", "tortas-jugos-2"],
    ["Mi", "mi-menu"],
    ["¡¿!?", "menu"],
  ])("%s → %s", (name, slug) => {
    expect(slugBase(name)).toBe(slug);
  });

  it("recorta a 46 caracteres sin dejar un guion al final", () => {
    const base = slugBase(`${"a".repeat(45)} bcd`);
    expect(base).toBe("a".repeat(45));
  });
});

describe("firstFreeSlug", () => {
  it("usa la base si está libre; si no, el primer sufijo libre", () => {
    expect(firstFreeSlug("tacos", new Set())).toBe("tacos");
    expect(firstFreeSlug("tacos", new Set(["tacos"]))).toBe("tacos-2");
    expect(firstFreeSlug("tacos", new Set(["tacos", "tacos-2", "tacos-4"]))).toBe("tacos-3");
  });

  it("una base reservada empieza en -2", () => {
    expect(firstFreeSlug("admin", new Set())).toBe("admin-2");
    expect(firstFreeSlug("verificar-correo", new Set())).toBe("verificar-correo-2");
  });
});
