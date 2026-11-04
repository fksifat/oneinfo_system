interface Contact {
  displayName: string;
  company: string;
  headline: string;
  phone: string;
  email: string;
  website: string;
}

export function contactVcard(contact: Contact): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
  return ["BEGIN:VCARD", "VERSION:3.0", `FN:${escape(contact.displayName)}`, `ORG:${escape(contact.company)}`,
    `TITLE:${escape(contact.headline)}`, `TEL:${escape(contact.phone)}`, `EMAIL:${escape(contact.email)}`,
    `URL:${escape(contact.website)}`, "END:VCARD", ""].join("\r\n");
}
