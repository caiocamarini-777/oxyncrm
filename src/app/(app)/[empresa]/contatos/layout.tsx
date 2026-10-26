import { ContactsTabs } from "@/components/records/contacts-tabs";

export const instant = false;

export default async function ContactsLayout({ children, params }: LayoutProps<"/[empresa]/contatos">) {
  const { empresa } = await params;
  return (
    <div className="flex flex-col gap-4">
      <ContactsTabs scopeSlug={empresa} />
      {children}
    </div>
  );
}
