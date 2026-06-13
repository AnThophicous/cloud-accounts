import enRaw from "./en.lang?raw";
import ptRaw from "./pt.lang?raw";
import esRaw from "./es.lang?raw";
import type { Locale } from "../../shared/types";

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en: parseLang(enRaw),
  pt: parseLang(ptRaw),
  es: parseLang(esRaw),
};

function parseLang(source: string): Dictionary {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reduce<Dictionary>((acc, line) => {
      const index = line.indexOf("=");
      if (index <= 0) return acc;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) acc[key] = value;
      return acc;
    }, {});
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries.en;
}

export function translate(locale: Locale, key: string, fallback = key): string {
  return getDictionary(locale)[key] ?? dictionaries.en[key] ?? fallback;
}

export function useLocaleCopy(locale: Locale) {
  const dictionary = getDictionary(locale);
  return {
    t: (key: string, fallback?: string) => translate(locale, key, fallback),
    dictionary,
  };
}
