"use client";
import { createContext, useContext, useMemo } from "react";
import { translate, type Locale } from "@/lib/i18n";
const LocaleContext = createContext<Locale>("zh");
export function LocaleProvider({locale,children}:{locale:Locale;children:React.ReactNode}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const locale = useContext(LocaleContext);
  const tr = useMemo(() => (key:string, values:unknown[] = []) => translate(locale,key,values),[locale]);
  return {locale,tr};
}
