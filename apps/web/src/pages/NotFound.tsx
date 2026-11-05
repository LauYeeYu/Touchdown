import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";

export function NotFound({ what = t("shell.notFound.what"), back = { to: "/", label: t("shell.notFound.home") } }: { what?: string; back?: { to: string; label: string } }) {
  return (
    <div className="page placeholder">
      <h1 className="lead">{what}</h1>
      <p>
        <Link className="link-arrow" to={back.to}>
          <Icon name="arrow-left" /> {back.label}
        </Link>
      </p>
    </div>
  );
}
