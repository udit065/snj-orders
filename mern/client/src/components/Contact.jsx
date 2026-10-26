import { useT } from "../i18n.jsx";
// How to reach SNJ: call and WhatsApp buttons, as staff set them under News.
const digits = (s) => String(s || "").replace(/\D/g, "");
const intl = (s) => (digits(s).length === 10 ? `91${digits(s)}` : digits(s));

export default function Contact({ contact }) {
  const t = useT();
  if (!contact || (!contact.phone && !contact.whatsapp && !contact.email)) return null;
  return (
    <div className="contact">
      <div>
        <div className="strong">{contact.name || t("Talk to SNJ")}</div>
        {contact.hours && <div className="muted small">{contact.hours}</div>}
      </div>
      <div className="contact-actions">
        {contact.phone && <a className="btn btn-secondary btn-sm" href={`tel:+${intl(contact.phone)}`}>{t("📞 Call")}</a>}
        {contact.whatsapp && <a className="btn btn-secondary btn-sm" href={`https://wa.me/${intl(contact.whatsapp)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
        {contact.email && <a className="btn btn-ghost btn-sm" href={`mailto:${contact.email}`}>{t("✉ Email")}</a>}
      </div>
    </div>
  );
}
