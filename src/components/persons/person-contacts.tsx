import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/records/format";
import { isWhatsappPhone, whatsappHref, type ContactEntry } from "@/lib/persons/schema";

/** E-mails e telefones clicáveis. WhatsApp só para celular. */
export function PersonContacts({ emails, phones }: { emails: ContactEntry[]; phones: ContactEntry[] }) {
  if (emails.length === 0 && phones.length === 0) return null;
  return (
    <Card data-testid="person-contacts">
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Contatos</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {emails.map((e) => (
            <li key={`e-${e.value}`} className="flex flex-wrap items-center gap-x-2">
              <span className="w-16 text-xs text-muted-foreground">{e.label}</span>
              <a href={`mailto:${e.value}`} className="text-primary hover:underline">
                {e.value}
              </a>
            </li>
          ))}
          {phones.map((p) => (
            <li key={`p-${p.value}`} className="flex flex-wrap items-center gap-x-2">
              <span className="w-16 text-xs text-muted-foreground">{p.label}</span>
              <a href={`tel:+55${p.value.replace(/^55(?=\d{10,11}$)/, "")}`} className="text-primary hover:underline">
                {formatPhone(p.value)}
              </a>
              {isWhatsappPhone(p) ? (
                <a
                  href={whatsappHref(p.value)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp ${formatPhone(p.value)}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  WhatsApp
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
