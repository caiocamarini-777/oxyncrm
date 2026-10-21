import { RESERVED_SLUGS } from "./constants";

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (RESERVED_SLUGS as readonly string[]).includes(slug) ? `${slug}-1` : slug;
}
