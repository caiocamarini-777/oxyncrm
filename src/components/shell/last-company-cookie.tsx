"use client";

import { useEffect } from "react";
import { LAST_COMPANY_COOKIE } from "@/lib/companies/constants";

export function LastCompanyCookie({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `${LAST_COMPANY_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}
