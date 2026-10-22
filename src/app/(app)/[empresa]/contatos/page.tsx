import { redirect } from "next/navigation";

export const instant = false;

// A Task 7 troca este redirecionamento pela lista de pessoas.
export default async function ContactsIndex({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  redirect(`/${empresa}/contatos/organizacoes`);
}
